import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import { withAuthRetry } from '../api/withAuthRetry';
import { cancelBooking, listBookings } from '../api/bookings';
import type { Booking, BookingStatus } from '../api/bookings';
import { getRide } from '../api/rides';
import type { Ride } from '../api/rides';
import { listRatingsForBooking, submitRating as submitRatingRequest } from '../api/ratings';
import type { Rating } from '../api/ratings';
import { ApiError } from '../api/client';
import { BottomNav } from '../components/BottomNav';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Textarea } from '../components/ui/Input';
import { cn } from '../lib/cn';

// Same two-tone chip language already established by RideDetailScreen's
// booking-confirmation panel (amber for "needs attention", emerald for
// "good") — this design system has no dedicated danger token, so
// PAYMENT_FAILED reuses amber rather than inventing a new color.
const STATUS_STYLES: Record<BookingStatus, { label: string; className: string }> = {
  PENDING_PAYMENT: { label: 'PENDING PAYMENT', className: 'border-amber-300 text-amber-700' },
  CONFIRMED: { label: 'CONFIRMED', className: 'border-emerald-300 text-accent-700' },
  PAYMENT_FAILED: { label: 'PAYMENT FAILED', className: 'border-amber-300 text-amber-700' },
  CANCELLED: { label: 'CANCELLED', className: 'border-border-strong text-ink-faint' },
  COMPLETED: { label: 'COMPLETED', className: 'border-emerald-300 text-accent-700' },
};

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`;
}

// Mirrors bookingService.cancelBooking's own eligibility exactly
// (PENDING_PAYMENT or CONFIRMED, and the ride hasn't STARTED/COMPLETED) —
// a UX hint only, not the real gate. `ride` can be undefined (its fetch
// failed, or hasn't resolved yet); when unknown, the button is still shown
// and the backend's own re-check is what actually decides, surfaced
// honestly via whatever error it returns.
function canCancelBooking(booking: Booking, ride: Ride | undefined): boolean {
  if (booking.status !== 'PENDING_PAYMENT' && booking.status !== 'CONFIRMED') {
    return false;
  }
  if (ride && (ride.status === 'STARTED' || ride.status === 'COMPLETED')) {
    return false;
  }
  return true;
}

// Mirrors ratingService.submitRating's own gate exactly: eligibility is
// decided by the RIDE's status (COMPLETED), never the booking's — a UX
// hint only, not the real gate, same convention as canCancelBooking above.
// Unlike that function, this one also requires the ride to be KNOWN (its
// fetch already succeeded): showing a rating prompt that would almost
// always come back 409 while the ride's status is unresolved would be
// misleading rather than harmless. Restricted further to CONFIRMED/
// COMPLETED bookings — the backend's own check would also accept a
// CANCELLED or PAYMENT_FAILED booking on a since-completed ride (it only
// ever looks at the ride), but offering to rate a trip the passenger never
// actually took would be misleading, so this is a strictly tighter client
// hint, never a looser one.
function canRateDriver(booking: Booking, ride: Ride | undefined): boolean {
  if (booking.status !== 'CONFIRMED' && booking.status !== 'COMPLETED') {
    return false;
  }
  return ride?.status === 'COMPLETED';
}

export function TripsScreen() {
  const session = useSession();
  const navigate = useNavigate();

  const [bookings, setBookings] = useState<Booking[]>([]);
  // rideId -> Ride. A ride missing from this map (after loading finishes)
  // means its fetch failed — the card falls back to a plain message instead
  // of blocking the rest of the list.
  const [rides, setRides] = useState<Record<string, Ride>>({});
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Synchronous guard against a rapid double-click/tap firing two overlapping
  // "load more" requests before React re-renders with `disabled` applied —
  // `loadingMore` (state) can't close that gap, since both invocations would
  // read the same stale value until the first one's update is committed.
  // Unlike the booking-creation POST, GET /bookings carries no Idempotency-
  // Key, so a raced duplicate call here has no backend-side backstop and
  // would otherwise double-append the same page.
  const loadMoreInFlightRef = useRef(false);
  // Which booking's inline "are you sure?" confirmation is open — at most
  // one at a time, so confirming one booking's cancellation implicitly
  // closes any other card's confirmation.
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null);
  // Which booking is actively being cancelled right now (drives the
  // loading state); per-booking error messages, keyed by booking id, so
  // one card's error never clobbers or hides another's.
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelErrors, setCancelErrors] = useState<Record<string, string>>({});
  // Synchronous guard, same reasoning as loadMoreInFlightRef: a rapid
  // double-click could otherwise fire two overlapping cancel requests for
  // the same booking before React re-renders with the button disabled.
  // Unlike booking creation, this POST carries no Idempotency-Key, so
  // there's no backend-side backstop against a raced duplicate here either.
  const cancelInFlightRef = useRef<Set<string>>(new Set());

  // Which booking's rating panel is expanded — at most one at a time, same
  // pattern as confirmingCancelId. Ratings are fetched lazily, only when a
  // panel is opened, to avoid an extra GET per completed booking on every
  // page load.
  const [ratingPanelOpenId, setRatingPanelOpenId] = useState<string | null>(null);
  // bookingId -> every rating on that booking (at most two: passenger->driver
  // and driver->passenger). Absence of a key means "not fetched yet", not
  // "no ratings" — `undefined` and `[]` are distinguished throughout below.
  const [ratingsByBooking, setRatingsByBooking] = useState<Record<string, Rating[]>>({});
  const [ratingLoadingId, setRatingLoadingId] = useState<string | null>(null);
  const [ratingLoadErrors, setRatingLoadErrors] = useState<Record<string, string>>({});
  const [ratingSubmittingId, setRatingSubmittingId] = useState<string | null>(null);
  const [ratingSubmitErrors, setRatingSubmitErrors] = useState<Record<string, string>>({});
  const [ratingFormScore, setRatingFormScore] = useState<number | null>(null);
  const [ratingFormComment, setRatingFormComment] = useState('');
  // Synchronous guards, same reasoning as loadMoreInFlightRef/cancelInFlightRef.
  const ratingFetchInFlightRef = useRef<Set<string>>(new Set());
  const ratingSubmitInFlightRef = useRef<Set<string>>(new Set());

  // Fetches ride details only for ids not already known — avoids re-fetching
  // a ride that appeared on an earlier page, and de-duplicates within one
  // page if more than one booking shares the same ride. A failed fetch for
  // one ride is isolated via allSettled and simply omitted from the
  // returned map, never fails the whole page.
  async function fetchMissingRides(
    items: Booking[],
    knownRides: Record<string, Ride>,
  ): Promise<Record<string, Ride>> {
    const idsToFetch = Array.from(new Set(items.map((booking) => booking.rideId))).filter(
      (id) => !(id in knownRides),
    );

    if (idsToFetch.length === 0) {
      return {};
    }

    const results = await Promise.allSettled(
      idsToFetch.map((rideId) => withAuthRetry(session, (token) => getRide(rideId, token))),
    );

    const fetched: Record<string, Ride> = {};
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        fetched[idsToFetch[index]] = result.value;
      }
    });
    return fetched;
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const page = await withAuthRetry(session, (token) => listBookings({}, token));
        if (cancelled) return;
        const fetchedRides = await fetchMissingRides(page.items, {});
        if (cancelled) return;
        setBookings(page.items);
        setRides(fetchedRides);
        setNextCursor(page.nextCursor);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Mount-once: unlike ResultsScreen this screen has no query params to
    // react to, and session's identity is stable per its own context memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLoadMore() {
    if (!nextCursor || loadMoreInFlightRef.current) return;
    loadMoreInFlightRef.current = true;
    setLoadingMore(true);
    try {
      const page = await withAuthRetry(session, (token) => listBookings({ cursor: nextCursor }, token));
      const fetchedRides = await fetchMissingRides(page.items, rides);
      setRides((current) => ({ ...current, ...fetchedRides }));
      setBookings((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.');
    } finally {
      loadMoreInFlightRef.current = false;
      setLoadingMore(false);
    }
  }

  // Cancels one booking and merges the ACTUAL returned booking back into
  // the list in place — never assumes CANCELLED client-side. No refund is
  // claimed here: the backend's cancelBooking never issues one for a
  // self-cancellation, and this function surfaces nothing that would imply
  // otherwise.
  async function handleConfirmCancel(bookingId: string) {
    if (cancelInFlightRef.current.has(bookingId)) return;
    cancelInFlightRef.current.add(bookingId);
    setCancellingId(bookingId);
    setCancelErrors((current) => {
      if (!(bookingId in current)) return current;
      const next = { ...current };
      delete next[bookingId];
      return next;
    });

    try {
      const updated = await withAuthRetry(session, (token) => cancelBooking(bookingId, token));
      setBookings((current) => current.map((booking) => (booking.id === bookingId ? updated : booking)));
      setConfirmingCancelId(null);
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.';
      setCancelErrors((current) => ({ ...current, [bookingId]: message }));
    } finally {
      cancelInFlightRef.current.delete(bookingId);
      setCancellingId(null);
    }
  }

  // Loads (or re-loads) every rating recorded against one booking —
  // authoritative, never merged with an optimistic guess. Called on first
  // panel open, on retry after a load error, and to re-sync after an
  // ALREADY_RATED race (e.g. the same passenger rating from a second tab).
  async function loadRatingsForBooking(bookingId: string) {
    if (ratingFetchInFlightRef.current.has(bookingId)) return;
    ratingFetchInFlightRef.current.add(bookingId);
    setRatingLoadingId(bookingId);
    setRatingLoadErrors((current) => {
      if (!(bookingId in current)) return current;
      const next = { ...current };
      delete next[bookingId];
      return next;
    });

    try {
      const result = await withAuthRetry(session, (token) => listRatingsForBooking(bookingId, token));
      setRatingsByBooking((current) => ({ ...current, [bookingId]: result }));
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.';
      setRatingLoadErrors((current) => ({ ...current, [bookingId]: message }));
    } finally {
      ratingFetchInFlightRef.current.delete(bookingId);
      setRatingLoadingId((current) => (current === bookingId ? null : current));
    }
  }

  // Toggles one booking's rating panel open/closed. Opening a panel that
  // hasn't been fetched yet (or previously failed to fetch) triggers the
  // lazy load above and resets the submission form — the backend's own
  // duplicate check is what actually matters, but resetting here avoids
  // carrying a stale score/comment over from a different booking's form.
  function handleToggleRatingPanel(bookingId: string) {
    if (ratingPanelOpenId === bookingId) {
      setRatingPanelOpenId(null);
      return;
    }
    setRatingPanelOpenId(bookingId);
    setRatingFormScore(null);
    setRatingFormComment('');
    if (!(bookingId in ratingsByBooking)) {
      void loadRatingsForBooking(bookingId);
    }
  }

  // Submits a rating and replaces the form with the ACTUAL returned Rating
  // — never marked as submitted optimistically. On the one race the backend
  // can still reject this through (ALREADY_RATED, e.g. a second tab), the
  // ratings list is re-fetched so the UI reflects the server's real record
  // instead of staying stuck on a form that can never succeed.
  async function handleSubmitRating(bookingId: string) {
    if (ratingFormScore === null || ratingSubmitInFlightRef.current.has(bookingId)) return;
    ratingSubmitInFlightRef.current.add(bookingId);
    setRatingSubmittingId(bookingId);
    setRatingSubmitErrors((current) => {
      if (!(bookingId in current)) return current;
      const next = { ...current };
      delete next[bookingId];
      return next;
    });

    try {
      const comment = ratingFormComment.trim();
      const submitted = await withAuthRetry(session, (token) =>
        submitRatingRequest(bookingId, { score: ratingFormScore, comment: comment || undefined }, token),
      );
      setRatingsByBooking((current) => ({
        ...current,
        [bookingId]: [...(current[bookingId] ?? []), submitted],
      }));
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.';
      setRatingSubmitErrors((current) => ({ ...current, [bookingId]: message }));
      if (cause instanceof ApiError && cause.code === 'ALREADY_RATED') {
        void loadRatingsForBooking(bookingId);
      }
    } finally {
      ratingSubmitInFlightRef.current.delete(bookingId);
      setRatingSubmittingId((current) => (current === bookingId ? null : current));
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 pb-24">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">My trips</h1>

      <div className="flex flex-col gap-3">
        {loading && <p className="py-12 text-center text-sm text-ink-muted">Loading your trips…</p>}

        {!loading && error && bookings.length === 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700">{error}</div>
        )}

        {!loading && !error && bookings.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <div>
              <p className="text-sm font-semibold text-ink">No trips yet</p>
              <p className="mt-1.5 text-xs text-ink-muted">Once you book a seat, it will show up here.</p>
            </div>
            <Button onClick={() => navigate('/search')}>Find a ride</Button>
          </div>
        )}

        {!loading && bookings.length > 0 && (
          <>
            {error && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700">{error}</div>
            )}

            {bookings.map((booking) => {
              const ride = rides[booking.rideId];
              const statusStyle = STATUS_STYLES[booking.status];

              const eligibleForCancel = canCancelBooking(booking, ride);
              const confirming = confirmingCancelId === booking.id;
              const cancelling = cancellingId === booking.id;
              const cancelError = cancelErrors[booking.id];

              const eligibleForRating = canRateDriver(booking, ride);
              const ratingPanelOpen = ratingPanelOpenId === booking.id;
              const bookingRatings = ratingsByBooking[booking.id];
              const myRating = bookingRatings?.find((r) => r.raterId === session.user?.id) ?? null;
              const ratingsLoading = ratingLoadingId === booking.id;
              const ratingLoadError = ratingLoadErrors[booking.id];
              const submittingRating = ratingSubmittingId === booking.id;
              const ratingSubmitError = ratingSubmitErrors[booking.id];

              return (
                <Card key={booking.id} className="flex flex-col gap-2.5 p-4">
                  <button
                    type="button"
                    onClick={() => navigate(`/rides/${booking.rideId}`, { state: { bookingId: booking.id } })}
                    className="flex w-full flex-col gap-2.5 border-0 bg-transparent p-0 text-left text-ink"
                  >
                    <div className="flex items-start justify-between">
                      <span className="text-xs text-ink-muted">Booked {formatDateTime(booking.createdAt)}</span>
                      <span
                        className={cn(
                          'shrink-0 rounded-full border bg-slate-50 px-2.5 py-0.5 font-mono text-[10px] tracking-wider',
                          statusStyle.className,
                        )}
                      >
                        {statusStyle.label}
                      </span>
                    </div>

                    {ride ? (
                      <div className="flex items-baseline justify-between">
                        <span className="font-mono text-lg font-semibold text-ink">
                          {formatDateTime(ride.departureTime)}
                        </span>
                        <span className="font-mono text-xs text-ink-muted">
                          {(ride.routeDistanceMeters / 1000).toFixed(1)} km · {formatDuration(ride.routeDurationSeconds)}
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs text-ink-muted">Ride details unavailable</p>
                    )}

                    <div className="flex justify-between text-sm text-ink">
                      <span>₹{booking.farePerSeat} × {booking.seats} seat{booking.seats === 1 ? '' : 's'}</span>
                      <span className="font-mono">₹{booking.totalFare.toLocaleString('en-IN')}</span>
                    </div>

                    {booking.status === 'PENDING_PAYMENT' && (
                      <p className="text-xs text-ink-muted">
                        Seat held but not yet paid for — it isn't confirmed for travel until payment
                        settles.
                      </p>
                    )}
                    {booking.status === 'CANCELLED' && (
                      <p className="text-xs text-ink-muted">
                        This booking was cancelled. Any amount already paid for it is not automatically
                        refunded.
                      </p>
                    )}
                  </button>

                  {eligibleForCancel && (
                    <div className="flex flex-col gap-2 border-t border-dashed border-border-subtle pt-2.5">
                      {cancelError && <p role="alert" className="text-xs text-red-600">{cancelError}</p>}
                      {confirming ? (
                        <>
                          <p className="text-xs text-ink-muted">
                            Cancel this booking? The prepayment isn't refunded for a self-cancellation.
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant="danger"
                              size="sm"
                              className="flex-1"
                              disabled={cancelling}
                              loading={cancelling}
                              onClick={() => void handleConfirmCancel(booking.id)}
                            >
                              Yes, cancel
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="flex-1"
                              disabled={cancelling}
                              onClick={() => setConfirmingCancelId(null)}
                            >
                              Keep booking
                            </Button>
                          </div>
                        </>
                      ) : (
                        <Button variant="secondary" size="sm" className="w-fit" onClick={() => setConfirmingCancelId(booking.id)}>
                          Cancel booking
                        </Button>
                      )}
                    </div>
                  )}

                  {eligibleForRating && (
                    <div className="flex flex-col gap-2 border-t border-dashed border-border-subtle pt-2.5">
                      <Button variant="secondary" size="sm" className="w-fit" onClick={() => handleToggleRatingPanel(booking.id)}>
                        {ratingPanelOpen ? 'Hide rating' : 'Rate your driver'}
                      </Button>

                      {ratingPanelOpen && (
                        <div className="flex flex-col gap-2">
                          {ratingsLoading && <p className="text-xs text-ink-muted">Checking rating status…</p>}

                          {!ratingsLoading && ratingLoadError && (
                            <>
                              <p role="alert" className="text-xs text-red-600">{ratingLoadError}</p>
                              <Button
                                variant="secondary"
                                size="sm"
                                className="w-fit"
                                onClick={() => void loadRatingsForBooking(booking.id)}
                              >
                                Retry
                              </Button>
                            </>
                          )}

                          {!ratingsLoading && !ratingLoadError && bookingRatings !== undefined && (
                            myRating ? (
                              <div className="flex flex-col gap-1">
                                <span className="text-sm font-semibold text-ink">
                                  You rated this driver {myRating.score}/5
                                </span>
                                {myRating.comment && (
                                  <p className="text-xs text-ink-muted">“{myRating.comment}”</p>
                                )}
                              </div>
                            ) : (
                              <>
                                <div className="flex gap-1.5">
                                  {[1, 2, 3, 4, 5].map((score) => (
                                    <button
                                      key={score}
                                      type="button"
                                      aria-pressed={ratingFormScore === score}
                                      onClick={() => setRatingFormScore(score)}
                                      className={cn(
                                        'flex-1 rounded-lg border py-2 font-mono text-sm font-semibold transition-colors',
                                        ratingFormScore === score
                                          ? 'border-accent-700 bg-accent-50 text-ink'
                                          : 'border-border-strong bg-surface text-ink-muted',
                                      )}
                                    >
                                      {score}
                                    </button>
                                  ))}
                                </div>
                                <Textarea
                                  placeholder="Add a comment (optional)"
                                  value={ratingFormComment}
                                  onChange={(event) => setRatingFormComment(event.target.value)}
                                  rows={2}
                                />
                                {ratingSubmitError && (
                                  <p role="alert" className="text-xs text-red-600">{ratingSubmitError}</p>
                                )}
                                <Button
                                  size="sm"
                                  disabled={ratingFormScore === null}
                                  loading={submittingRating}
                                  onClick={() => void handleSubmitRating(booking.id)}
                                >
                                  Submit rating
                                </Button>
                              </>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}

            {nextCursor && (
              <Button
                variant="ghost"
                className="border border-dashed border-border-strong"
                loading={loadingMore}
                onClick={() => void handleLoadMore()}
              >
                Load more trips
              </Button>
            )}
          </>
        )}
      </div>
      <BottomNav />
    </div>
  );
}

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

// Same two-tone chip language already established by RideDetailScreen's
// booking-confirmation panel (warning for "needs attention", success-border
// for "good") — this design system has no dedicated danger/red token, so
// PAYMENT_FAILED reuses warning rather than inventing a new color.
const STATUS_STYLES: Record<BookingStatus, { label: string; border: string; color: string }> = {
  PENDING_PAYMENT: { label: 'PENDING PAYMENT', border: 'var(--warning-border)', color: 'var(--warning)' },
  CONFIRMED: { label: 'CONFIRMED', border: 'var(--success-border)', color: 'var(--accent)' },
  PAYMENT_FAILED: { label: 'PAYMENT FAILED', border: 'var(--warning-border)', color: 'var(--warning)' },
  CANCELLED: { label: 'CANCELLED', border: 'var(--border)', color: 'var(--text-muted)' },
  COMPLETED: { label: 'COMPLETED', border: 'var(--success-border)', color: 'var(--accent)' },
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
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-ui)', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          padding: '20px 16px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--surface-1)',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>My trips</h1>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 100px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading && (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '48px 0' }}>Loading your trips…</p>
        )}

        {!loading && error && bookings.length === 0 && (
          <div style={{ padding: 16, borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--warning-border)', color: 'var(--warning)', fontSize: 14 }}>
            {error}
          </div>
        )}

        {!loading && !error && bookings.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '48px 16px', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
            <div>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>No trips yet</p>
              <p style={{ margin: '6px 0 0', fontSize: 13 }}>Once you book a seat, it will show up here.</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/search')}
              style={{ height: 48, padding: '0 24px', borderRadius: 14, border: 0, background: 'var(--accent)', color: 'var(--accent-on)', font: '600 14px var(--font-ui)', cursor: 'pointer' }}
            >
              Find a ride
            </button>
          </div>
        )}

        {!loading && bookings.length > 0 && (
          <>
            {error && (
              <div style={{ padding: 16, borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--warning-border)', color: 'var(--warning)', fontSize: 14 }}>
                {error}
              </div>
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
                <div
                  key={booking.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    padding: 16,
                    borderRadius: 22,
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border-subtle)',
                    boxShadow: 'var(--card-shadow)',
                    color: 'var(--text)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/rides/${booking.rideId}`, { state: { bookingId: booking.id } })}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                      padding: 0,
                      border: 0,
                      background: 'transparent',
                      color: 'var(--text)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      width: '100%',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Booked {formatDateTime(booking.createdAt)}
                      </span>
                      <span
                        style={{
                          borderRadius: 'var(--radius-chip)',
                          border: `1px solid ${statusStyle.border}`,
                          background: 'var(--surface-3)',
                          color: statusStyle.color,
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          letterSpacing: '.08em',
                          padding: '3px 9px',
                          flexShrink: 0,
                        }}
                      >
                        {statusStyle.label}
                      </span>
                    </div>

                    {ride ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span style={{ font: '600 20px var(--font-mono)' }}>{formatDateTime(ride.departureTime)}</span>
                        <span style={{ font: '400 11px var(--font-mono)', color: 'var(--text-muted)' }}>
                          {(ride.routeDistanceMeters / 1000).toFixed(1)} km · {formatDuration(ride.routeDurationSeconds)}
                        </span>
                      </div>
                    ) : (
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Ride details unavailable</p>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--text-2)' }}>
                      <span>₹{booking.farePerSeat} × {booking.seats} seat{booking.seats === 1 ? '' : 's'}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                        ₹{booking.totalFare.toLocaleString('en-IN')}
                      </span>
                    </div>

                    {booking.status === 'PENDING_PAYMENT' && (
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
                        Seat held but not yet paid for — it isn't confirmed for travel until payment
                        settles.
                      </p>
                    )}
                    {booking.status === 'CANCELLED' && (
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
                        This booking was cancelled. Any amount already paid for it is not automatically
                        refunded.
                      </p>
                    )}
                  </button>

                  {eligibleForCancel && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px dashed var(--border-subtle)', paddingTop: 10 }}>
                      {cancelError && (
                        <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--warning)' }}>
                          {cancelError}
                        </p>
                      )}
                      {confirming ? (
                        <>
                          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                            Cancel this booking? The prepayment isn't refunded for a self-cancellation.
                          </p>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              type="button"
                              disabled={cancelling}
                              onClick={() => void handleConfirmCancel(booking.id)}
                              style={{
                                flex: 1,
                                height: 40,
                                borderRadius: 'var(--radius-control)',
                                border: 0,
                                background: cancelling ? 'var(--surface-3)' : 'var(--warning)',
                                color: cancelling ? 'var(--text-muted)' : 'var(--warning-on)',
                                font: '700 13px var(--font-ui)',
                                cursor: cancelling ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {cancelling ? 'Cancelling…' : 'Yes, cancel'}
                            </button>
                            <button
                              type="button"
                              disabled={cancelling}
                              onClick={() => setConfirmingCancelId(null)}
                              style={{
                                flex: 1,
                                height: 40,
                                borderRadius: 'var(--radius-control)',
                                border: '1px solid var(--border)',
                                background: 'var(--surface-2)',
                                color: 'var(--text)',
                                font: '600 13px var(--font-ui)',
                                cursor: cancelling ? 'not-allowed' : 'pointer',
                              }}
                            >
                              Keep booking
                            </button>
                          </div>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmingCancelId(booking.id)}
                          style={{
                            height: 40,
                            borderRadius: 'var(--radius-control)',
                            border: '1px solid var(--border)',
                            background: 'var(--surface-2)',
                            color: 'var(--text-2)',
                            font: '600 13px var(--font-ui)',
                            cursor: 'pointer',
                          }}
                        >
                          Cancel booking
                        </button>
                      )}
                    </div>
                  )}

                  {eligibleForRating && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px dashed var(--border-subtle)', paddingTop: 10 }}>
                      <button
                        type="button"
                        onClick={() => handleToggleRatingPanel(booking.id)}
                        style={{
                          height: 40,
                          borderRadius: 'var(--radius-control)',
                          border: '1px solid var(--border)',
                          background: 'var(--surface-2)',
                          color: 'var(--accent-2)',
                          font: '600 13px var(--font-ui)',
                          cursor: 'pointer',
                        }}
                      >
                        {ratingPanelOpen ? 'Hide rating' : 'Rate your driver'}
                      </button>

                      {ratingPanelOpen && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {ratingsLoading && (
                            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                              Checking rating status…
                            </p>
                          )}

                          {!ratingsLoading && ratingLoadError && (
                            <>
                              <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--warning)' }}>
                                {ratingLoadError}
                              </p>
                              <button
                                type="button"
                                onClick={() => void loadRatingsForBooking(booking.id)}
                                style={{
                                  height: 44,
                                  borderRadius: 'var(--radius-control)',
                                  border: '1px solid var(--border)',
                                  background: 'var(--surface-2)',
                                  color: 'var(--text)',
                                  font: '600 12px var(--font-ui)',
                                  cursor: 'pointer',
                                }}
                              >
                                Retry
                              </button>
                            </>
                          )}

                          {!ratingsLoading && !ratingLoadError && bookingRatings !== undefined && (
                            myRating ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <span style={{ font: '600 13px var(--font-ui)', color: 'var(--text)' }}>
                                  You rated this driver {myRating.score}/5
                                </span>
                                {myRating.comment && (
                                  <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                                    “{myRating.comment}”
                                  </p>
                                )}
                              </div>
                            ) : (
                              <>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  {[1, 2, 3, 4, 5].map((score) => (
                                    <button
                                      key={score}
                                      type="button"
                                      aria-pressed={ratingFormScore === score}
                                      onClick={() => setRatingFormScore(score)}
                                      style={{
                                        flex: 1,
                                        height: 40,
                                        borderRadius: 'var(--radius-control)',
                                        border: `1px solid ${ratingFormScore === score ? 'var(--accent)' : 'var(--border)'}`,
                                        background: ratingFormScore === score ? 'rgba(11,129,147,.12)' : 'var(--surface-2)',
                                        color: ratingFormScore === score ? 'var(--text)' : 'var(--text-2)',
                                        font: '600 15px var(--font-mono)',
                                        cursor: 'pointer',
                                      }}
                                    >
                                      {score}
                                    </button>
                                  ))}
                                </div>
                                <textarea
                                  placeholder="Add a comment (optional)"
                                  value={ratingFormComment}
                                  onChange={(event) => setRatingFormComment(event.target.value)}
                                  rows={2}
                                  style={{
                                    resize: 'vertical',
                                    borderRadius: 'var(--radius-control)',
                                    border: '1px solid var(--border)',
                                    background: 'var(--surface-2)',
                                    color: 'var(--text)',
                                    font: '400 13px var(--font-ui)',
                                    padding: 10,
                                  }}
                                />
                                {ratingSubmitError && (
                                  <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--warning)' }}>
                                    {ratingSubmitError}
                                  </p>
                                )}
                                <button
                                  type="button"
                                  disabled={ratingFormScore === null || submittingRating}
                                  onClick={() => void handleSubmitRating(booking.id)}
                                  style={{
                                    height: 40,
                                    borderRadius: 'var(--radius-control)',
                                    border: 0,
                                    background:
                                      ratingFormScore === null || submittingRating ? 'var(--surface-3)' : 'var(--accent)',
                                    color:
                                      ratingFormScore === null || submittingRating ? 'var(--text-muted)' : 'var(--accent-on)',
                                    font: '700 13px var(--font-ui)',
                                    cursor: ratingFormScore === null || submittingRating ? 'not-allowed' : 'pointer',
                                  }}
                                >
                                  {submittingRating ? 'Submitting…' : 'Submit rating'}
                                </button>
                              </>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {nextCursor && (
              <button
                type="button"
                onClick={() => void handleLoadMore()}
                disabled={loadingMore}
                style={{ height: 52, borderRadius: 16, background: 'transparent', border: '1px dashed var(--border)', color: 'var(--text-2)', font: '500 14px var(--font-ui)', cursor: loadingMore ? 'default' : 'pointer' }}
              >
                {loadingMore ? 'Loading…' : 'Load more trips'}
              </button>
            )}
          </>
        )}
      </div>
      <BottomNav />
    </div>
  );
}

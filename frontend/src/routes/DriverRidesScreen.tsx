import { ChevronLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import { withAuthRetry } from '../api/withAuthRetry';
import { getMyRides, startRide, completeRide, cancelRide, listRideBookings } from '../api/rides';
import type { Ride, RideBookingItem } from '../api/rides';
import { listRatingsForBooking, submitRating as submitRatingRequest } from '../api/ratings';
import type { Rating } from '../api/ratings';
import { ApiError } from '../api/client';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Textarea } from '../components/ui/Input';
import { cn } from '../lib/cn';

type RideStatus = Ride['status'];
type RideAction = 'start' | 'complete' | 'cancel';

// Same two-tone chip language already established by TripsScreen/
// RideDetailScreen (amber for "needs attention", emerald for "good", slate
// for a settled/terminal state).
const STATUS_STYLES: Record<RideStatus, { label: string; className: string }> = {
  PENDING_PAYMENT: { label: 'PENDING PAYMENT', className: 'border-amber-300 text-amber-700' },
  OPEN: { label: 'OPEN', className: 'border-emerald-300 text-accent-700' },
  FULL: { label: 'FULL', className: 'border-emerald-300 text-accent-700' },
  STARTED: { label: 'STARTED', className: 'border-violet-300 text-violet-700' },
  COMPLETED: { label: 'COMPLETED', className: 'border-emerald-300 text-accent-700' },
  CANCELLED: { label: 'CANCELLED', className: 'border-border-strong text-ink-faint' },
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

function formatPoint(point: { lat: number; lng: number }): string {
  return `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;
}

// Mirrors rideRepository.transitionStatus/complete/cancel's own WHERE
// clauses exactly (verified directly against src/modules/ride/
// repositories/rideRepository.ts) — a UX hint for which actions to show,
// never the real gate: the backend's own conditional UPDATE is what
// actually decides, and a stale read here just surfaces as a 409
// INVALID_RIDE_STATE from the server, not a client-side assumption.
// OPEN/FULL genuinely permit BOTH start and cancel simultaneously — the
// backend doesn't pick one, so this doesn't either.
function availableActions(ride: Ride): RideAction[] {
  const actions: RideAction[] = [];
  if (ride.status === 'OPEN' || ride.status === 'FULL') actions.push('start');
  if (ride.status === 'STARTED') actions.push('complete');
  if (ride.status === 'PENDING_PAYMENT' || ride.status === 'OPEN' || ride.status === 'FULL') {
    actions.push('cancel');
  }
  return actions;
}

// Mirrors ratingService.submitRating's own gate exactly: eligibility is
// decided by the RIDE's status (COMPLETED), never the booking's — a UX
// hint only, not the real gate, same convention as TripsScreen.tsx's own
// canRateDriver. Restricted further to CONFIRMED/COMPLETED bookings for
// the identical reason that function is: the backend's own check would
// also accept a CANCELLED or PAYMENT_FAILED booking on a since-completed
// ride (it only ever looks at the ride), but offering to rate a passenger
// who never actually took the trip would be misleading — a strictly
// tighter client hint, never a looser one. In practice `ride` is always
// already COMPLETED here (the passenger panel below is only ever shown
// for a completed ride), but the check is kept explicit rather than
// assumed.
function canRatePassenger(booking: RideBookingItem, ride: Ride): boolean {
  if (booking.status !== 'CONFIRMED' && booking.status !== 'COMPLETED') {
    return false;
  }
  return ride.status === 'COMPLETED';
}

const ACTION_LABEL: Record<RideAction, string> = {
  start: 'Start ride',
  complete: 'Complete ride',
  cancel: 'Cancel ride',
};

const ACTION_LOADING_LABEL: Record<RideAction, string> = {
  start: 'Starting…',
  complete: 'Completing…',
  cancel: 'Cancelling…',
};

export function DriverRidesScreen() {
  const session = useSession();
  const navigate = useNavigate();

  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Tracks the one action currently running, if any — a ride in OPEN/FULL
  // can show BOTH "Start" and "Cancel" at once, so this needs to know which
  // specific button was pressed (for its loading label) as well as which
  // ride (to disable the OTHER button on that same ride while one is
  // in flight, since starting and cancelling the same ride at once makes
  // no sense even though each is independently valid).
  const [activeAction, setActiveAction] = useState<{ rideId: string; action: RideAction } | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  // Synchronous guard, same reasoning as every other action list in this
  // app (TripsScreen's load-more/cancel): a rapid double-click could
  // otherwise fire two overlapping lifecycle requests for the same ride
  // before React re-renders with the button disabled. None of
  // start/complete/cancel carry an Idempotency-Key, so there's no
  // backend-side backstop against a raced duplicate here either.
  const actionInFlightRef = useRef<Set<string>>(new Set());

  // Which ride's passenger list is expanded — at most one at a time, same
  // pattern as TripsScreen's confirmingCancelId/ratingPanelOpenId. Loaded
  // lazily, only on open, and only ever for a COMPLETED ride (see the
  // render below — the toggle button itself only exists on a completed
  // ride's card, so there is no path that fetches this for any other
  // ride).
  const [passengersPanelOpenId, setPassengersPanelOpenId] = useState<string | null>(null);
  // rideId -> every booking fetched so far for that ride (accumulated
  // across "load more" pages). Absence of a key means "not fetched yet".
  const [passengersByRide, setPassengersByRide] = useState<Record<string, RideBookingItem[]>>({});
  const [passengersNextCursorByRide, setPassengersNextCursorByRide] = useState<
    Record<string, string | null>
  >({});
  const [passengersLoadingId, setPassengersLoadingId] = useState<string | null>(null);
  const [passengersLoadingMoreId, setPassengersLoadingMoreId] = useState<string | null>(null);
  // Carries the cursor the FAILED attempt used, alongside the message —
  // `cursor: undefined` means the failure was the initial (page 1) load;
  // a defined cursor means it was a "load more" page. Retry reads this
  // back so it retries the exact same request rather than always
  // restarting from page 1.
  const [passengersLoadErrors, setPassengersLoadErrors] = useState<
    Record<string, { message: string; cursor?: string }>
  >({});
  // Synchronous guard, same reasoning as actionInFlightRef above: a rapid
  // double-click (opening the panel, or "load more passengers") could
  // otherwise fire two overlapping GETs for the same ride.
  const passengersFetchInFlightRef = useRef<Set<string>>(new Set());

  // Rating state and logic below is ported directly from TripsScreen.tsx's
  // rating panel, keyed by bookingId (never by ride — a driver may have
  // several completed rides' passenger panels open across different
  // ride cards, and each booking's rating state must stay independent).
  const [ratingPanelOpenId, setRatingPanelOpenId] = useState<string | null>(null);
  const [ratingsByBooking, setRatingsByBooking] = useState<Record<string, Rating[]>>({});
  const [ratingLoadingId, setRatingLoadingId] = useState<string | null>(null);
  const [ratingLoadErrors, setRatingLoadErrors] = useState<Record<string, string>>({});
  const [ratingSubmittingId, setRatingSubmittingId] = useState<string | null>(null);
  const [ratingSubmitErrors, setRatingSubmitErrors] = useState<Record<string, string>>({});
  const [ratingFormScore, setRatingFormScore] = useState<number | null>(null);
  const [ratingFormComment, setRatingFormComment] = useState('');
  const ratingFetchInFlightRef = useRef<Set<string>>(new Set());
  const ratingSubmitInFlightRef = useRef<Set<string>>(new Set());

  function loadRides() {
    let cancelled = false;
    setLoading(true);
    setError(null);

    withAuthRetry(session, (token) => getMyRides(token))
      .then((page) => {
        if (!cancelled) setRides(page.items);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }

  useEffect(() => {
    const cancel = loadRides();
    return cancel;
    // Mount-once: session's identity is stable per its own context memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAction(ride: Ride, action: RideAction) {
    if (actionInFlightRef.current.has(ride.id)) return;
    actionInFlightRef.current.add(ride.id);
    setActiveAction({ rideId: ride.id, action });
    setActionErrors((current) => {
      if (!(ride.id in current)) return current;
      const next = { ...current };
      delete next[ride.id];
      return next;
    });

    try {
      const call = action === 'start' ? startRide : action === 'complete' ? completeRide : cancelRide;
      const updated = await withAuthRetry(session, (token) => call(ride.id, token));
      setRides((current) => current.map((r) => (r.id === ride.id ? updated : r)));
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.';
      setActionErrors((current) => ({ ...current, [ride.id]: message }));
    } finally {
      actionInFlightRef.current.delete(ride.id);
      setActiveAction(null);
    }
  }

  // Loads (or appends, when `cursor` is given) one page of bookings for one
  // ride. Only ever called from a COMPLETED ride's own toggle/load-more
  // buttons (see the render below) — never on mount, never for any other
  // ride.
  async function loadPassengers(rideId: string, cursor?: string) {
    if (passengersFetchInFlightRef.current.has(rideId)) return;
    passengersFetchInFlightRef.current.add(rideId);
    if (cursor) setPassengersLoadingMoreId(rideId);
    else setPassengersLoadingId(rideId);
    setPassengersLoadErrors((current) => {
      if (!(rideId in current)) return current;
      const next = { ...current };
      delete next[rideId];
      return next;
    });

    try {
      const page = await withAuthRetry(session, (token) =>
        listRideBookings(rideId, cursor ? { cursor } : {}, token),
      );
      setPassengersByRide((current) => ({
        ...current,
        [rideId]: cursor ? [...(current[rideId] ?? []), ...page.items] : page.items,
      }));
      setPassengersNextCursorByRide((current) => ({ ...current, [rideId]: page.nextCursor }));
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.';
      setPassengersLoadErrors((current) => ({ ...current, [rideId]: { message, cursor } }));
    } finally {
      passengersFetchInFlightRef.current.delete(rideId);
      if (cursor) setPassengersLoadingMoreId((current) => (current === rideId ? null : current));
      else setPassengersLoadingId((current) => (current === rideId ? null : current));
    }
  }

  // Toggles one ride's passenger panel open/closed. Opening a panel that
  // hasn't been fetched yet triggers the lazy load above — exactly once,
  // the same "fetch only when opened" discipline TripsScreen's rating
  // panel already uses.
  function handleTogglePassengers(rideId: string) {
    if (passengersPanelOpenId === rideId) {
      setPassengersPanelOpenId(null);
      return;
    }
    setPassengersPanelOpenId(rideId);
    if (!(rideId in passengersByRide)) {
      void loadPassengers(rideId);
    }
  }

  // --- Rating: ported directly from TripsScreen.tsx's rating panel ---

  // Loads (or re-loads) every rating recorded against one booking —
  // authoritative, never merged with an optimistic guess. Called on first
  // panel open, on retry after a load error, and to re-sync after an
  // ALREADY_RATED race.
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

  // Toggles one booking's rating panel open/closed, resetting the
  // submission form so a stale score/comment never carries over from a
  // different booking's form.
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
  // — never marked as submitted optimistically. On the one race the
  // backend can still reject this through (ALREADY_RATED, e.g. a second
  // tab), the ratings list is re-fetched so the UI reflects the server's
  // real record instead of staying stuck on a form that can never succeed.
  // RIDE_NOT_COMPLETED (should the ride somehow not actually be completed
  // despite the UI gate above) surfaces through the same generic error
  // path below, verbatim from the server — never reinterpreted.
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
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Back to driver hub"
          onClick={() => navigate('/driver')}
          className="flex size-10 items-center justify-center rounded-lg border border-border-strong bg-surface text-ink-muted transition-colors hover:bg-slate-50"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <h1 className="text-xl font-semibold tracking-tight text-ink">My rides</h1>
      </div>

      {loading && <p className="py-12 text-center text-sm text-ink-muted">Loading your rides…</p>}

      {!loading && error && rides.length === 0 && (
        <Card className="border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
          <Button variant="secondary" size="sm" className="mt-3 w-fit" onClick={() => loadRides()}>
            Try again
          </Button>
        </Card>
      )}

      {!loading && !error && rides.length === 0 && (
        <Card className="flex flex-col gap-2.5 p-5 text-center">
          <h2 className="text-base font-semibold text-ink">No rides posted yet</h2>
          <p className="text-sm text-ink-muted">Once you offer a ride, it will show up here with its current status.</p>
          <Button className="mt-1" onClick={() => navigate('/driver/offer')}>
            Offer a ride
          </Button>
        </Card>
      )}

      {!loading && rides.length > 0 && (
        <>
          {error && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700">{error}</div>
          )}

          {rides.map((ride) => {
            const statusStyle = STATUS_STYLES[ride.status];
            const actions = availableActions(ride);
            const actingOnThisRide = activeAction?.rideId === ride.id;
            const actionError = actionErrors[ride.id];

            return (
              <Card key={ride.id} className="flex flex-col gap-2.5 p-4">
                <div className="flex items-start justify-between">
                  <span className="font-mono text-lg font-semibold text-ink">
                    {formatDateTime(ride.departureTime)}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full border bg-slate-50 px-2.5 py-0.5 font-mono text-[10px] tracking-wider',
                      statusStyle.className,
                    )}
                  >
                    {statusStyle.label}
                  </span>
                </div>

                <div className="flex flex-col gap-1 font-mono text-xs text-ink-muted">
                  <span>From {formatPoint(ride.origin)}</span>
                  <span>To {formatPoint(ride.destination)}</span>
                </div>

                <div className="flex justify-between text-xs text-ink-muted">
                  <span>
                    {(ride.routeDistanceMeters / 1000).toFixed(1)} km · {formatDuration(ride.routeDurationSeconds)}
                  </span>
                  <span>{ride.availableSeats} / {ride.totalSeats} seats left</span>
                </div>

                <div className="flex justify-between text-sm text-ink">
                  <span>Fare per seat</span>
                  <span className="font-mono">₹{ride.farePerSeat.toLocaleString('en-IN')}</span>
                </div>

                {actions.length > 0 && (
                  <div className="flex flex-col gap-2 border-t border-dashed border-border-subtle pt-2.5">
                    {actionError && <p role="alert" className="text-xs text-red-600">{actionError}</p>}
                    <div className="flex gap-2">
                      {actions.map((action) => {
                        const isThisActionRunning = actingOnThisRide && activeAction?.action === action;
                        return (
                          <Button
                            key={action}
                            variant={action === 'cancel' ? 'secondary' : 'primary'}
                            size="sm"
                            className="flex-1"
                            disabled={actingOnThisRide}
                            loading={isThisActionRunning}
                            onClick={() => void handleAction(ride, action)}
                          >
                            {isThisActionRunning ? ACTION_LOADING_LABEL[action] : ACTION_LABEL[action]}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {(ride.status === 'OPEN' || ride.status === 'FULL' || ride.status === 'COMPLETED') && (
                  <div className="flex flex-col gap-2 border-t border-dashed border-border-subtle pt-2.5">
                    <Button variant="secondary" size="sm" className="w-fit" onClick={() => handleTogglePassengers(ride.id)}>
                      {passengersPanelOpenId === ride.id ? 'Hide passengers' : 'View passengers'}
                    </Button>

                    {passengersPanelOpenId === ride.id && (
                      <div className="flex flex-col gap-2.5">
                        {passengersByRide[ride.id] === undefined ? (
                          // Nothing has ever loaded for this ride yet — either
                          // still loading the first page, or that first attempt
                          // failed. There is no list to preserve in this branch.
                          passengersLoadingId === ride.id ? (
                            <p className="text-xs text-ink-muted">Loading passengers…</p>
                          ) : passengersLoadErrors[ride.id] ? (
                            <>
                              <p role="alert" className="text-xs text-red-600">
                                {passengersLoadErrors[ride.id].message}
                              </p>
                              <Button
                                variant="secondary"
                                size="sm"
                                className="w-fit"
                                onClick={() => void loadPassengers(ride.id, passengersLoadErrors[ride.id]?.cursor)}
                              >
                                Retry
                              </Button>
                            </>
                          ) : null
                        ) : passengersByRide[ride.id].length === 0 ? (
                          <p className="text-xs text-ink-muted">No one booked this ride.</p>
                        ) : (
                          <>
                            {passengersByRide[ride.id].map((booking) => {
                              const eligibleForRating = canRatePassenger(booking, ride);
                              const ratingOpen = ratingPanelOpenId === booking.id;
                              const bookingRatings = ratingsByBooking[booking.id];
                              const myRating =
                                bookingRatings?.find((r) => r.raterId === session.user?.id) ?? null;
                              const ratingsLoading = ratingLoadingId === booking.id;
                              const ratingLoadError = ratingLoadErrors[booking.id];
                              const submittingRating = ratingSubmittingId === booking.id;
                              const ratingSubmitError = ratingSubmitErrors[booking.id];

                              return (
                                <div
                                  key={booking.id}
                                  className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-slate-50 p-3"
                                >
                                  <div className="flex items-baseline justify-between">
                                    <span className="text-sm font-semibold text-ink">{booking.passengerName}</span>
                                    <span className="font-mono text-[10px] text-ink-muted">
                                      {booking.seats} seat{booking.seats === 1 ? '' : 's'}
                                    </span>
                                  </div>
                                  <span className="font-mono text-[10px] tracking-wider text-ink-muted">
                                    {booking.status}
                                  </span>
                                  {booking.status === 'CONFIRMED' && (
                                    <span
                                      className={cn(
                                        'w-fit rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                        booking.pickupConfirmedAt
                                          ? 'bg-accent-50 text-accent-700'
                                          : 'bg-amber-50 text-amber-700',
                                      )}
                                    >
                                      {booking.pickupConfirmedAt ? '✓ Confirmed pickup' : 'Not confirmed yet'}
                                    </span>
                                  )}

                                  {eligibleForRating && (
                                    <>
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        className="w-fit"
                                        onClick={() => handleToggleRatingPanel(booking.id)}
                                      >
                                        {ratingOpen ? 'Hide rating' : 'Rate this passenger'}
                                      </Button>

                                      {ratingOpen && (
                                        <div className="flex flex-col gap-2">
                                          {ratingsLoading && (
                                            <p className="text-xs text-ink-muted">Checking rating status…</p>
                                          )}

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
                                                  You rated this passenger {myRating.score}/5
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
                                                  <p role="alert" className="text-xs text-red-600">
                                                    {ratingSubmitError}
                                                  </p>
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
                                    </>
                                  )}
                                </div>
                              );
                            })}

                            {passengersLoadErrors[ride.id] ? (
                              // A LATER page failed — the list above is the
                              // same one already shown before the failure,
                              // untouched; this replaces only the "load
                              // more" button's own slot with an error +
                              // retry that reuses the exact cursor that
                              // failed (never the general, unrelated
                              // initial-load retry path above).
                              <>
                                <p role="alert" className="text-xs text-red-600">
                                  {passengersLoadErrors[ride.id].message}
                                </p>
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="w-fit"
                                  loading={passengersLoadingMoreId === ride.id}
                                  onClick={() => void loadPassengers(ride.id, passengersLoadErrors[ride.id]?.cursor)}
                                >
                                  Retry
                                </Button>
                              </>
                            ) : (
                              passengersNextCursorByRide[ride.id] && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="w-fit border border-dashed border-border-strong"
                                  loading={passengersLoadingMoreId === ride.id}
                                  onClick={() =>
                                    void loadPassengers(ride.id, passengersNextCursorByRide[ride.id] ?? undefined)
                                  }
                                >
                                  Load more passengers
                                </Button>
                              )
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}

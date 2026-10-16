import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import { withAuthRetry } from '../api/withAuthRetry';
import { getMyRides, startRide, completeRide, cancelRide, listRideBookings } from '../api/rides';
import type { Ride, RideBookingItem } from '../api/rides';
import { listRatingsForBooking, submitRating as submitRatingRequest } from '../api/ratings';
import type { Rating } from '../api/ratings';
import { ApiError } from '../api/client';

type RideStatus = Ride['status'];
type RideAction = 'start' | 'complete' | 'cancel';

// Same two-tone chip language already established by TripsScreen/
// RideDetailScreen (warning for "needs attention", success-border for
// "good", muted for a settled/terminal state) — this design system has no
// dedicated danger/red token.
const STATUS_STYLES: Record<RideStatus, { label: string; border: string; color: string }> = {
  PENDING_PAYMENT: { label: 'PENDING PAYMENT', border: 'var(--warning-border)', color: 'var(--warning)' },
  OPEN: { label: 'OPEN', border: 'var(--success-border)', color: 'var(--accent)' },
  FULL: { label: 'FULL', border: 'var(--success-border)', color: 'var(--accent)' },
  STARTED: { label: 'STARTED', border: 'var(--border)', color: 'var(--accent-2)' },
  COMPLETED: { label: 'COMPLETED', border: 'var(--success-border)', color: 'var(--accent)' },
  CANCELLED: { label: 'CANCELLED', border: 'var(--border)', color: 'var(--text-muted)' },
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
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
      <div style={{ maxWidth: 390, margin: '0 auto', padding: '20px 16px 48px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            type="button"
            aria-label="Back to driver hub"
            onClick={() => navigate('/driver')}
            style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>My rides</h1>
        </div>

        {loading && (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '48px 0' }}>Loading your rides…</p>
        )}

        {!loading && error && rides.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--warning-border)' }}>
            <p style={{ margin: 0, color: 'var(--warning)', fontSize: 14 }}>{error}</p>
            <button
              type="button"
              onClick={() => loadRides()}
              style={{ height: 40, borderRadius: 'var(--radius-control)', border: '1px solid var(--border)', background: 'var(--surface-3)', color: 'var(--accent-2)', font: '600 13px var(--font-ui)', cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && rides.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 20, borderRadius: 22, background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>No rides posted yet</h2>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-muted)' }}>
              Once you offer a ride, it will show up here with its current status.
            </p>
            <button
              type="button"
              onClick={() => navigate('/driver/offer')}
              style={{ height: 48, borderRadius: 14, border: 0, background: 'var(--accent)', color: 'var(--accent-on)', font: '600 14px var(--font-ui)', cursor: 'pointer' }}
            >
              Offer a ride
            </button>
          </div>
        )}

        {!loading && rides.length > 0 && (
          <>
            {error && (
              <div style={{ padding: 16, borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--warning-border)', color: 'var(--warning)', fontSize: 14 }}>
                {error}
              </div>
            )}

            {rides.map((ride) => {
              const statusStyle = STATUS_STYLES[ride.status];
              const actions = availableActions(ride);
              const actingOnThisRide = activeAction?.rideId === ride.id;
              const actionError = actionErrors[ride.id];

              return (
                <div
                  key={ride.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    padding: 16,
                    borderRadius: 22,
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <span style={{ font: '600 18px var(--font-mono)' }}>{formatDateTime(ride.departureTime)}</span>
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

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                    <span>From {formatPoint(ride.origin)}</span>
                    <span>To {formatPoint(ride.destination)}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-2)' }}>
                    <span>{(ride.routeDistanceMeters / 1000).toFixed(1)} km · {formatDuration(ride.routeDurationSeconds)}</span>
                    <span>{ride.availableSeats} / {ride.totalSeats} seats left</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--text-2)' }}>
                    <span>Fare per seat</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                      ₹{ride.farePerSeat.toLocaleString('en-IN')}
                    </span>
                  </div>

                  {actions.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px dashed var(--border-subtle)', paddingTop: 10 }}>
                      {actionError && (
                        <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--warning)' }}>
                          {actionError}
                        </p>
                      )}
                      <div style={{ display: 'flex', gap: 8 }}>
                        {actions.map((action) => {
                          const isThisActionRunning = actingOnThisRide && activeAction?.action === action;
                          return (
                            <button
                              key={action}
                              type="button"
                              disabled={actingOnThisRide}
                              onClick={() => void handleAction(ride, action)}
                              style={{
                                flex: 1,
                                height: 44,
                                borderRadius: 'var(--radius-control)',
                                border: action === 'cancel' ? '1px solid var(--border)' : 0,
                                background: actingOnThisRide
                                  ? 'var(--surface-3)'
                                  : action === 'cancel'
                                    ? 'var(--surface-2)'
                                    : 'var(--accent)',
                                color: actingOnThisRide
                                  ? 'var(--text-muted)'
                                  : action === 'cancel'
                                    ? 'var(--text-2)'
                                    : 'var(--accent-on)',
                                font: '700 13px var(--font-ui)',
                                cursor: actingOnThisRide ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {isThisActionRunning ? ACTION_LOADING_LABEL[action] : ACTION_LABEL[action]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {ride.status === 'COMPLETED' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px dashed var(--border-subtle)', paddingTop: 10 }}>
                      <button
                        type="button"
                        onClick={() => handleTogglePassengers(ride.id)}
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
                        {passengersPanelOpenId === ride.id ? 'Hide passengers' : 'View passengers'}
                      </button>

                      {passengersPanelOpenId === ride.id && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {passengersByRide[ride.id] === undefined ? (
                            // Nothing has ever loaded for this ride yet — either
                            // still loading the first page, or that first attempt
                            // failed. There is no list to preserve in this branch.
                            passengersLoadingId === ride.id ? (
                              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                                Loading passengers…
                              </p>
                            ) : passengersLoadErrors[ride.id] ? (
                              <>
                                <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--warning)' }}>
                                  {passengersLoadErrors[ride.id].message}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => void loadPassengers(ride.id, passengersLoadErrors[ride.id]?.cursor)}
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
                            ) : null
                          ) : passengersByRide[ride.id].length === 0 ? (
                            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                              No one booked this ride.
                            </p>
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
                                      style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 8,
                                        padding: 12,
                                        borderRadius: 14,
                                        background: 'var(--surface-2)',
                                        border: '1px solid var(--border-subtle)',
                                      }}
                                    >
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                        <span style={{ fontSize: 14, fontWeight: 600 }}>{booking.passengerName}</span>
                                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                                          {booking.seats} seat{booking.seats === 1 ? '' : 's'}
                                        </span>
                                      </div>
                                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.08em', color: 'var(--text-muted)' }}>
                                        {booking.status}
                                      </span>

                                      {eligibleForRating && (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => handleToggleRatingPanel(booking.id)}
                                            style={{
                                              height: 40,
                                              borderRadius: 'var(--radius-control)',
                                              border: '1px solid var(--border)',
                                              background: 'var(--surface-3)',
                                              color: 'var(--accent-2)',
                                              font: '600 12px var(--font-ui)',
                                              cursor: 'pointer',
                                            }}
                                          >
                                            {ratingOpen ? 'Hide rating' : 'Rate this passenger'}
                                          </button>

                                          {ratingOpen && (
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
                                                      background: 'var(--surface-3)',
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
                                                      You rated this passenger {myRating.score}/5
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
                                                            background: ratingFormScore === score ? 'rgba(46,230,246,.12)' : 'var(--surface-3)',
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
                                                        background: 'var(--surface-3)',
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
                                                          ratingFormScore === null || submittingRating ? 'var(--surface-2)' : 'var(--accent)',
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
                                    <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--warning)' }}>
                                      {passengersLoadErrors[ride.id].message}
                                    </p>
                                    <button
                                      type="button"
                                      disabled={passengersLoadingMoreId === ride.id}
                                      onClick={() =>
                                        void loadPassengers(ride.id, passengersLoadErrors[ride.id]?.cursor)
                                      }
                                      style={{
                                        height: 44,
                                        borderRadius: 'var(--radius-control)',
                                        border: '1px solid var(--border)',
                                        background: 'var(--surface-2)',
                                        color: 'var(--text)',
                                        font: '600 12px var(--font-ui)',
                                        cursor: passengersLoadingMoreId === ride.id ? 'default' : 'pointer',
                                      }}
                                    >
                                      {passengersLoadingMoreId === ride.id ? 'Loading…' : 'Retry'}
                                    </button>
                                  </>
                                ) : (
                                  passengersNextCursorByRide[ride.id] && (
                                    <button
                                      type="button"
                                      disabled={passengersLoadingMoreId === ride.id}
                                      onClick={() =>
                                        void loadPassengers(ride.id, passengersNextCursorByRide[ride.id] ?? undefined)
                                      }
                                      style={{
                                        height: 44,
                                        borderRadius: 'var(--radius-control)',
                                        background: 'transparent',
                                        border: '1px dashed var(--border)',
                                        color: 'var(--text-2)',
                                        font: '500 13px var(--font-ui)',
                                        cursor: passengersLoadingMoreId === ride.id ? 'default' : 'pointer',
                                      }}
                                    >
                                      {passengersLoadingMoreId === ride.id ? 'Loading…' : 'Load more passengers'}
                                    </button>
                                  )
                                )}
                              </>
                            )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

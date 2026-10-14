import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useSession } from '../auth/session';
import { withAuthRetry } from '../api/withAuthRetry';
import { getRide } from '../api/rides';
import type { Ride, RideSearchItem } from '../api/rides';
import { createBooking, getBooking, getBookingCheckout } from '../api/bookings';
import type { Booking } from '../api/bookings';
import { ApiError } from '../api/client';
import { isValidCheckoutDetails, loadRazorpayCheckout } from '../api/razorpayCheckout';
import type { RazorpayCheckoutInstance } from '../api/razorpayCheckout';
import { RoutePreview } from '../components/RoutePreview';

interface LocationState {
  searchItem?: RideSearchItem;
  pickupLabel?: string;
  dropLabel?: string;
  seats?: number;
  // Set only by TripsScreen, when navigating here for a booking the
  // passenger already has on this ride — never trusted as proof of
  // anything by itself (router state is just a hint of WHICH booking to
  // fetch); the GET below is what actually verifies ownership and status.
  bookingId?: string;
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(iso),
  );
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`;
}

// Mirrors bookingService.createBooking's own gate (OPEN or FULL, and seats
// available) exactly — a UX hint only, not the real gate: the backend's own
// check is what actually decides, and a stale read here just surfaces as a
// 409 (RIDE_NOT_BOOKABLE / NO_SEATS_AVAILABLE) from the server, same as
// every other "mirrors the backend" hint in this app.
function rideBookability(ride: Ride): { bookable: boolean; reason: string | null } {
  if (ride.status !== 'OPEN' && ride.status !== 'FULL') {
    return { bookable: false, reason: 'This ride is no longer open for booking.' };
  }
  if (ride.availableSeats === 0) {
    return { bookable: false, reason: 'No seats are available on this ride anymore.' };
  }
  return { bookable: true, reason: null };
}

export function RideDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const session = useSession();

  const state = (location.state as LocationState | null) ?? {};
  const { searchItem, pickupLabel, dropLabel, seats = 1, bookingId: viewBookingId } = state;

  const [ride, setRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [booking, setBooking] = useState<Booking | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Only set when arriving with a `bookingId` (from TripsScreen) — loads
  // the passenger's OWN authoritative booking via GET /bookings/:id, which
  // is itself participant-scoped (404 for anyone else). This is what
  // actually proves the booking, never the router state that pointed here.
  // While this is in flight or has failed, the "Book this ride" CTA below
  // must stay hidden — falling back to it would recreate exactly the
  // duplicate-booking risk this view exists to avoid.
  const [viewedBookingLoading, setViewedBookingLoading] = useState(Boolean(viewBookingId));
  const [viewedBookingError, setViewedBookingError] = useState<string | null>(null);
  // One key per logical booking attempt, not per network call: reused across
  // the automatic 401-refresh retry inside withAuthRetry (same closure, same
  // key) and across a manual retry after a NETWORK_ERROR (we never learned
  // whether the server saw the first one, so replaying it is the safe
  // choice). Cleared — so the next click mints a fresh key — once the
  // server actually answers (success, or any other coded rejection), since
  // that answer is a definitive outcome and a further click is a genuinely
  // new attempt, not a continuation of this one.
  const idempotencyKeyRef = useRef<string | null>(null);

  // Re-checks this booking's authoritative status. This is a read, never a
  // trigger: there is no endpoint the frontend can call to create or launch
  // a checkout, and this request cannot make a payment happen — it only
  // reflects whatever the backend's own webhook has already settled.
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [statusCheckError, setStatusCheckError] = useState<string | null>(null);

  // Opening Checkout.js. Synchronous ref, checked before any await, so a
  // rapid double-click/tap can't launch two modals at once — and stays true
  // for the WHOLE time Razorpay's own modal could be open (launch until
  // dismiss/success/failure), not just during setup.
  const checkoutInFlightRef = useRef(false);
  const [checkoutOpening, setCheckoutOpening] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  // The active modal, if one is open — Checkout.js attaches it directly to
  // document.body, outside React's tree, so nothing but an explicit
  // instance.close() call tears it down. Cleared whenever a checkout
  // attempt ends (any outcome) or setup fails, so it's never stale.
  const checkoutInstanceRef = useRef<RazorpayCheckoutInstance | null>(null);
  // Guards every setState below against firing after this screen has
  // unmounted — distinct from the ride-fetch effect's own local `cancelled`
  // flag, since this one also has to be read from inside Razorpay's
  // callbacks, which can fire long after the component that registered
  // them is gone.
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      // Close whatever modal is still open, if any — this never re-enables
      // checkoutInFlightRef or touches any state; the component is gone,
      // so there is no "allow another checkout" concern, only "don't leave
      // a floating overlay behind."
      checkoutInstanceRef.current?.close();
      checkoutInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    withAuthRetry(session, (token) => getRide(id, token))
      .then((result) => {
        if (!cancelled) setRide(result);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function loadViewedBooking(idToLoad: string) {
    let cancelled = false;
    setViewedBookingLoading(true);
    setViewedBookingError(null);

    withAuthRetry(session, (token) => getBooking(idToLoad, token))
      .then((result) => {
        if (!cancelled) setBooking(result);
      })
      .catch((cause) => {
        if (!cancelled) {
          setViewedBookingError(cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.');
        }
      })
      .finally(() => {
        if (!cancelled) setViewedBookingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }

  useEffect(() => {
    if (!viewBookingId) return;
    return loadViewedBooking(viewBookingId);
    // Intentionally keyed only on the id itself, not on the whole location
    // state object (which is a new reference every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewBookingId]);

  async function handleBook() {
    // The `viewBookingId` check is defense in depth: the CTA that calls this
    // is never rendered while a view-mode booking is loading, errored, or
    // loaded (booking is truthy by then) — but router state must never be
    // the only thing standing between a click and a second booking.
    if (!ride || submitting || booking || viewBookingId) return;

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }
    const key = idempotencyKeyRef.current;

    setSubmitError(null);
    setSubmitting(true);
    try {
      const created = await withAuthRetry(session, (token) =>
        createBooking(ride.id, { seats }, key, token),
      );
      idempotencyKeyRef.current = null;
      setBooking(created);

      // Re-fetch the ride's own authoritative state so the seat count
      // displayed above reflects what was just reserved — never decremented
      // locally. Best-effort: the booking itself already succeeded, so a
      // failed refresh here just leaves the seat count stale, same as
      // before this ride was re-fetched at all.
      withAuthRetry(session, (token) => getRide(ride.id, token))
        .then((refreshed) => {
          if (mountedRef.current) setRide(refreshed);
        })
        .catch(() => {});
    } catch (cause) {
      if (cause instanceof ApiError) {
        // A NETWORK_ERROR means the request may never have reached the
        // server at all — keep the key so a retry safely replays the same
        // logical submission. Any other ApiError is a definitive answer
        // from the server, so the next click should be a new attempt.
        if (cause.code !== 'NETWORK_ERROR') {
          idempotencyKeyRef.current = null;
        }
        setSubmitError(cause.message);
      } else {
        setSubmitError('Something went wrong. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCheckStatus() {
    if (!booking || checkingStatus) return;
    setStatusCheckError(null);
    setCheckingStatus(true);
    try {
      const updated = await withAuthRetry(session, (token) => getBooking(booking.id, token));
      if (mountedRef.current) setBooking(updated);
    } catch (cause) {
      if (mountedRef.current) {
        setStatusCheckError(cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.');
      }
    } finally {
      if (mountedRef.current) setCheckingStatus(false);
    }
  }

  // Launches Razorpay Checkout.js against the EXISTING pending order — this
  // never creates a booking, a ride, or a new payment order; it only reads
  // the order's own checkout coordinates (GET /bookings/:id/checkout) and
  // opens the gateway's own modal against them. Whatever Checkout.js
  // reports back (success, failure, or the user simply closing it) is never
  // trusted as proof of payment — architecture.md: "the client's success
  // callback is never authoritative." Every one of those three outcomes
  // does the exact same thing: release the guard and re-check the
  // authoritative status through the existing GET endpoint. Only the
  // backend's signature-verified webhook actually confirms payment.
  async function handleOpenCheckout() {
    if (!booking || checkoutInFlightRef.current) return;
    checkoutInFlightRef.current = true;
    setCheckoutError(null);
    setCheckoutOpening(true);

    // Shared by every terminal path (success, dismiss, failure): the modal
    // is done, so the instance ref is cleared and the guard released
    // unconditionally. Only the setState calls are gated on mountedRef —
    // nothing here re-permits a new checkout that shouldn't happen.
    function releaseAndRecheck() {
      checkoutInstanceRef.current = null;
      checkoutInFlightRef.current = false;
      if (!mountedRef.current) return;
      setCheckoutOpening(false);
      void handleCheckStatus();
    }

    try {
      const details = await withAuthRetry(session, (token) => getBookingCheckout(booking.id, token));

      if (!mountedRef.current) {
        checkoutInFlightRef.current = false;
        return;
      }

      if (!isValidCheckoutDetails(details)) {
        throw new Error('The payment details received were invalid. Try again.');
      }

      await loadRazorpayCheckout();

      if (!mountedRef.current) {
        checkoutInFlightRef.current = false;
        return;
      }

      if (!window.Razorpay) {
        throw new Error('Checkout is unavailable right now.');
      }

      const instance = new window.Razorpay({
        key: details.keyId,
        order_id: details.orderId,
        amount: details.amount,
        currency: details.currency,
        name: 'SaathiRide',
        description: 'Seat prepayment',
        prefill: {
          name: session.user?.name,
          email: session.user?.email,
          contact: session.user?.phone,
        },
        theme: { color: '#2ee6f6' },
        modal: { ondismiss: releaseAndRecheck },
        handler: releaseAndRecheck,
      });
      checkoutInstanceRef.current = instance;
      instance.on('payment.failed', releaseAndRecheck);
      instance.open();
    } catch (cause) {
      checkoutInstanceRef.current = null;
      checkoutInFlightRef.current = false;
      if (!mountedRef.current) return;
      setCheckoutOpening(false);

      // A stale order (the booking already resolved since this screen last
      // fetched it) is reported with the backend's own neutral message —
      // never recast as a payment failure — and is itself a signal worth
      // acting on: re-check status now rather than waiting for the user to
      // notice and tap "Check payment status" separately. handleCheckStatus
      // own guard (checkingStatus) keeps this from double-firing if one is
      // already in flight.
      if (cause instanceof ApiError && cause.code === 'CHECKOUT_NOT_AVAILABLE') {
        setCheckoutError(cause.message);
        void handleCheckStatus();
        return;
      }

      setCheckoutError(
        cause instanceof ApiError || cause instanceof Error
          ? cause.message
          : 'Could not open checkout. Try again.',
      );
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-ui)' }}>
        Loading ride…
      </div>
    );
  }

  if (error || !ride) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
        <p style={{ color: 'var(--warning)' }}>{error ?? 'Ride not found.'}</p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          style={{ height: 48, padding: '0 24px', borderRadius: 14, border: 0, background: 'var(--accent)', color: 'var(--accent-on)', font: '600 14px var(--font-ui)', cursor: 'pointer' }}
        >
          Go back
        </button>
      </div>
    );
  }

  const arrivalIso = new Date(new Date(ride.departureTime).getTime() + ride.routeDurationSeconds * 1000).toISOString();
  const totalFare = ride.farePerSeat * seats;
  const prepay = Math.round(totalFare * 0.1);
  const rest = totalFare - prepay;
  const { bookable, reason: bookabilityReason } = rideBookability(ride);

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
      <div style={{ position: 'relative' }}>
        <RoutePreview height={220} />
        <div style={{ position: 'absolute', top: 16, left: 16, right: 16, display: 'flex', justifyContent: 'space-between' }}>
          <button
            type="button"
            aria-label="Back to results"
            onClick={() => navigate(-1)}
            style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(8,12,22,.6)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <span style={{ height: 44, padding: '0 12px', borderRadius: 14, background: 'rgba(8,12,22,.6)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, font: '500 12px var(--font-mono)', color: 'var(--text-2)' }}>
            {(ride.routeDistanceMeters / 1000).toFixed(1)} km · {formatDuration(ride.routeDurationSeconds)}
          </span>
        </div>
      </div>

      <div style={{ maxWidth: 390, margin: '0 auto', padding: '16px 16px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 10px var(--accent)' }} />
            <span style={{ width: 2, flex: 1, margin: '4px 0', background: 'linear-gradient(var(--accent), var(--accent-2))' }} />
            <span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--accent-2)', boxShadow: '0 0 10px var(--accent-2)' }} />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{pickupLabel ?? 'Pickup'}</span>
              <span style={{ font: '600 20px var(--font-mono)' }}>{formatTime(ride.departureTime)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 16, fontWeight: 600 }}>{dropLabel ?? 'Drop'}</span>
              <span style={{ font: '600 20px var(--font-mono)', color: 'var(--text-2)' }}>{formatTime(arrivalIso)}</span>
            </div>
          </div>
        </div>

        {searchItem ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 20, background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
            <span style={{ width: 48, height: 48, borderRadius: '50%', padding: 2, background: 'conic-gradient(var(--accent), var(--accent-2), var(--accent))', flexShrink: 0 }}>
              <span style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '600 16px var(--font-ui)' }}>
                {searchItem.driver.name.slice(0, 2).toUpperCase()}
              </span>
            </span>
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 16, fontWeight: 600 }}>{searchItem.driver.name}</span>
              <span style={{ font: '400 12px var(--font-mono)', color: 'var(--text-muted)' }}>
                <span style={{ color: 'var(--star)' }}>
                  ★ {searchItem.driver.ratingAverage == null ? 'New' : searchItem.driver.ratingAverage.toFixed(1)}
                </span>
              </span>
            </span>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
            Driver details aren't available when opening a ride directly — go back to results to see them.
          </p>
        )}

        {searchItem && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
            <div style={{ padding: '10px 12px', borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ font: '400 10px var(--font-mono)', letterSpacing: '.1em', color: 'var(--text-muted)' }}>VEHICLE</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{searchItem.vehicle.model ?? '—'}</span>
            </div>
            <div style={{ padding: '10px 12px', borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ font: '400 10px var(--font-mono)', letterSpacing: '.1em', color: 'var(--text-muted)' }}>TYPE</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{searchItem.vehicle.vehicleType}</span>
            </div>
            <div style={{ padding: '10px 12px', borderRadius: 14, background: searchItem.vehicle.isAc ? 'rgba(46,230,246,.06)' : 'var(--surface-2)', border: `1px solid ${searchItem.vehicle.isAc ? 'var(--success-border)' : 'var(--border-subtle)'}`, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ font: '400 10px var(--font-mono)', letterSpacing: '.1em', color: 'var(--text-muted)' }}>CLIMATE</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: searchItem.vehicle.isAc ? 'var(--accent)' : 'var(--text)' }}>
                {searchItem.vehicle.isAc ? 'AC' : 'Non-AC'}
              </span>
            </div>
          </div>
        )}

        <div style={{ padding: '14px 16px', borderRadius: 20, background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
          <span style={{ font: '400 10px var(--font-mono)', letterSpacing: '.1em', color: 'var(--text-muted)' }}>AVAILABLE SEATS</span>
          <div style={{ marginTop: 4, font: '600 22px var(--font-mono)', color: ride.availableSeats === 1 ? 'var(--warning)' : 'var(--accent)' }}>
            {ride.availableSeats} / {ride.totalSeats}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 22, background: 'var(--surface-2)', border: '1px solid var(--border-subtle)', fontSize: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-2)' }}>
            <span>₹{ride.farePerSeat} × {seats} seat{seats === 1 ? '' : 's'}</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>₹{totalFare.toLocaleString('en-IN')}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-2)' }}>
            <span>Pay now · 10% to hold</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>₹{prepay.toLocaleString('en-IN')}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-2)' }}>
            <span>After the ride · 90%</span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>₹{rest.toLocaleString('en-IN')}</span>
          </div>
          <span style={{ height: 1, background: 'var(--border-subtle)' }} />
          <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--text-muted)' }}>
            Fare is locked when you book — it never changes later.
          </span>
        </div>

        {booking ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: 16,
              borderRadius: 22,
              background: 'var(--surface-2)',
              border: '1px solid var(--success-border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ font: '700 16px var(--font-ui)' }}>Seat held</span>
              <span
                style={{
                  borderRadius: 'var(--radius-chip)',
                  border: '1px solid var(--warning-border)',
                  background: 'var(--surface-3)',
                  color: 'var(--warning)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  letterSpacing: '.08em',
                  padding: '4px 10px',
                }}
              >
                {booking.status === 'PENDING_PAYMENT' ? 'PENDING PAYMENT' : booking.status}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted)' }}>
              <span>Booking ID</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{booking.id}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--text-2)' }}>
              <span>₹{booking.farePerSeat} × {booking.seats} seat{booking.seats === 1 ? '' : 's'}</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                ₹{booking.totalFare.toLocaleString('en-IN')}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--text-2)' }}>
              <span>Due now · 10%</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                ₹{booking.prepaidAmount.toLocaleString('en-IN')}
              </span>
            </div>
            {booking.paymentOrderId && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                <span>Payment reference</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}>
                  {booking.paymentOrderId}
                </span>
              </div>
            )}
            <span style={{ height: 1, background: 'var(--border-subtle)' }} />

            {booking.status === 'PENDING_PAYMENT' && (
              <>
                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)' }}>
                  Your seat is held but not yet paid for — it isn't confirmed for travel until
                  payment settles. Pay now, or check again if you already completed payment
                  elsewhere.
                </p>
                {checkoutError && (
                  <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--warning)' }}>
                    {checkoutError}
                  </p>
                )}
                {statusCheckError && (
                  <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--warning)' }}>
                    {statusCheckError}
                  </p>
                )}
                <button
                  type="button"
                  disabled={checkoutOpening || checkingStatus}
                  onClick={() => void handleOpenCheckout()}
                  style={{
                    height: 48,
                    borderRadius: 'var(--radius-control)',
                    border: 0,
                    background: checkoutOpening || checkingStatus ? 'var(--surface-3)' : 'var(--accent)',
                    color: checkoutOpening || checkingStatus ? 'var(--text-muted)' : 'var(--accent-on)',
                    font: '700 14px var(--font-ui)',
                    cursor: checkoutOpening || checkingStatus ? 'not-allowed' : 'pointer',
                  }}
                >
                  {checkoutOpening ? 'Opening checkout…' : 'Pay now'}
                </button>
                <button
                  type="button"
                  disabled={checkoutOpening || checkingStatus}
                  onClick={() => void handleCheckStatus()}
                  style={{
                    height: 44,
                    borderRadius: 'var(--radius-control)',
                    border: '1px solid var(--border)',
                    background: 'var(--surface-3)',
                    color: checkoutOpening || checkingStatus ? 'var(--text-muted)' : 'var(--accent-2)',
                    font: '600 13px var(--font-ui)',
                    cursor: checkoutOpening || checkingStatus ? 'not-allowed' : 'pointer',
                  }}
                >
                  {checkingStatus ? 'Checking…' : 'Check payment status'}
                </button>
              </>
            )}
            {booking.status === 'CONFIRMED' && (
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)' }}>
                Payment confirmed — this seat is booked.
              </p>
            )}
            {booking.status === 'PAYMENT_FAILED' && (
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)' }}>
                This payment failed and the seat hold was released.
              </p>
            )}
            {booking.status === 'CANCELLED' && (
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)' }}>
                This booking was cancelled.
              </p>
            )}
            {booking.status === 'COMPLETED' && (
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)' }}>
                This trip is complete.
              </p>
            )}
          </div>
        ) : viewBookingId ? (
          // Viewing an existing booking (arrived from My Trips) — never the
          // "Book this ride" CTA, even while this is loading or failed: that
          // CTA only belongs to the separate, explicit create-a-new-booking
          // flow below.
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: 16,
              borderRadius: 22,
              background: 'var(--surface-2)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {viewedBookingLoading && (
              <p style={{ margin: 0, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                Loading your booking…
              </p>
            )}
            {!viewedBookingLoading && viewedBookingError && (
              <>
                <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--warning)' }}>
                  {viewedBookingError}
                </p>
                <button
                  type="button"
                  onClick={() => loadViewedBooking(viewBookingId)}
                  style={{
                    height: 44,
                    borderRadius: 'var(--radius-control)',
                    border: '1px solid var(--border)',
                    background: 'var(--surface-3)',
                    color: 'var(--accent-2)',
                    font: '600 13px var(--font-ui)',
                    cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
              </>
            )}
          </div>
        ) : (
          <>
            {submitError && (
              <p
                role="alert"
                style={{
                  margin: 0,
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--warning-border)',
                  color: 'var(--warning)',
                  fontSize: 13,
                  lineHeight: 1.4,
                }}
              >
                {submitError}
              </p>
            )}
            {!bookable && bookabilityReason && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>{bookabilityReason}</p>
            )}
            <button
              type="button"
              disabled={submitting || !bookable}
              onClick={() => void handleBook()}
              style={{
                height: 58,
                borderRadius: 18,
                border: 0,
                cursor: submitting || !bookable ? 'not-allowed' : 'pointer',
                background: submitting || !bookable ? 'var(--surface-3)' : 'var(--accent)',
                color: submitting || !bookable ? 'var(--text-muted)' : 'var(--accent-on)',
                font: '700 16px var(--font-ui)',
                boxShadow: submitting || !bookable ? 'none' : 'var(--accent-glow)',
              }}
            >
              {submitting ? 'Booking…' : 'Book this ride'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

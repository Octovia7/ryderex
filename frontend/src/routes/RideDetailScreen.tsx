import { ChevronLeft } from 'lucide-react';
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
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { cn } from '../lib/cn';

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
        theme: { color: '#0b8193' },
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
    return <p className="py-16 text-center text-sm text-ink-muted">Loading ride…</p>;
  }

  if (error || !ride) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-sm text-red-600">{error ?? 'Ride not found.'}</p>
        <Button onClick={() => navigate(-1)}>Go back</Button>
      </div>
    );
  }

  const arrivalIso = new Date(new Date(ride.departureTime).getTime() + ride.routeDurationSeconds * 1000).toISOString();
  const totalFare = ride.farePerSeat * seats;
  const prepay = Math.round(totalFare * 0.1);
  const rest = totalFare - prepay;
  const { bookable, reason: bookabilityReason } = rideBookability(ride);

  return (
    <div className="mx-auto max-w-xl">
      <div style={{ position: 'relative' }}>
        <RoutePreview height={220} />
        <div className="absolute inset-x-4 top-4 flex justify-between">
          <button
            type="button"
            aria-label="Back to results"
            onClick={() => navigate(-1)}
            className="flex size-11 items-center justify-center rounded-xl border border-border-strong bg-slate-900/60 backdrop-blur"
          >
            <ChevronLeft className="size-[18px] text-white" aria-hidden />
          </button>
          <span className="flex h-11 items-center gap-2 rounded-xl border border-border-strong bg-slate-900/60 px-3 font-mono text-xs text-white backdrop-blur">
            {(ride.routeDistanceMeters / 1000).toFixed(1)} km · {formatDuration(ride.routeDurationSeconds)}
          </span>
        </div>
      </div>

      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
        <div className="flex gap-3.5">
          <div className="flex flex-col items-center pt-1.5">
            <span className="size-2.5 rounded-full bg-accent-600" />
            <span className="my-1 w-0.5 flex-1 bg-gradient-to-b from-accent-600 to-violet-500" />
            <span className="size-2.5 rounded-sm bg-violet-500" />
          </div>
          <div className="flex flex-1 flex-col gap-3.5">
            <div className="flex justify-between gap-2.5">
              <span className="text-base font-semibold text-ink">{pickupLabel ?? 'Pickup'}</span>
              <span className="font-mono text-xl font-semibold text-ink">{formatTime(ride.departureTime)}</span>
            </div>
            <div className="flex justify-between gap-2.5">
              <span className="text-base font-semibold text-ink">{dropLabel ?? 'Drop'}</span>
              <span className="font-mono text-xl font-semibold text-ink-muted">{formatTime(arrivalIso)}</span>
            </div>
          </div>
        </div>

        {searchItem ? (
          <div className="flex items-center gap-3 rounded-xl border border-border-subtle bg-slate-50 p-3.5">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-100 text-base font-semibold text-accent-800">
              {searchItem.driver.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="text-base font-semibold text-ink">{searchItem.driver.name}</span>
              <span className="font-mono text-xs text-amber-600">
                ★ {searchItem.driver.ratingAverage == null ? 'New' : searchItem.driver.ratingAverage.toFixed(1)}
              </span>
            </span>
          </div>
        ) : (
          <p className="text-xs text-ink-muted">
            Driver details aren't available when opening a ride directly — go back to results to see them.
          </p>
        )}

        {searchItem && (
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-0.5 rounded-lg border border-border-subtle bg-slate-50 px-3 py-2.5">
              <span className="font-mono text-[10px] tracking-wider text-ink-muted">VEHICLE</span>
              <span className="text-sm font-semibold text-ink">{searchItem.vehicle.model ?? '—'}</span>
            </div>
            <div className="flex flex-col gap-0.5 rounded-lg border border-border-subtle bg-slate-50 px-3 py-2.5">
              <span className="font-mono text-[10px] tracking-wider text-ink-muted">TYPE</span>
              <span className="text-sm font-semibold text-ink">{searchItem.vehicle.vehicleType}</span>
            </div>
            <div
              className={cn(
                'flex flex-col gap-0.5 rounded-lg border px-3 py-2.5',
                searchItem.vehicle.isAc ? 'border-emerald-300 bg-accent-50' : 'border-border-subtle bg-slate-50',
              )}
            >
              <span className="font-mono text-[10px] tracking-wider text-ink-muted">CLIMATE</span>
              <span className={cn('text-sm font-semibold', searchItem.vehicle.isAc ? 'text-accent-700' : 'text-ink')}>
                {searchItem.vehicle.isAc ? 'AC' : 'Non-AC'}
              </span>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-border-subtle bg-slate-50 px-4 py-3.5">
          <span className="font-mono text-[10px] tracking-wider text-ink-muted">AVAILABLE SEATS</span>
          <div
            className={cn(
              'mt-1 font-mono text-2xl font-semibold',
              ride.availableSeats === 1 ? 'text-amber-600' : 'text-accent-700',
            )}
          >
            {ride.availableSeats} / {ride.totalSeats}
          </div>
        </div>

        <Card className="flex flex-col gap-2.5 p-4 text-sm">
          <div className="flex justify-between text-ink">
            <span>₹{ride.farePerSeat} × {seats} seat{seats === 1 ? '' : 's'}</span>
            <span className="font-mono">₹{totalFare.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex justify-between text-ink">
            <span>Pay now · 10% to hold</span>
            <span className="font-mono text-accent-700">₹{prepay.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex justify-between text-ink">
            <span>After the ride · 90%</span>
            <span className="font-mono">₹{rest.toLocaleString('en-IN')}</span>
          </div>
          <span className="h-px bg-border-subtle" />
          <span className="text-xs leading-relaxed text-ink-muted">
            Fare is locked when you book — it never changes later.
          </span>
        </Card>

        {booking ? (
          <Card className="flex flex-col gap-2.5 border-emerald-200 bg-emerald-50/40 p-4">
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-ink">Seat held</span>
              <span className="rounded-full border border-amber-300 bg-slate-50 px-2.5 py-1 font-mono text-xs tracking-wider text-amber-700">
                {booking.status === 'PENDING_PAYMENT' ? 'PENDING PAYMENT' : booking.status}
              </span>
            </div>
            <div className="flex justify-between text-xs text-ink-muted">
              <span>Booking ID</span>
              <span className="font-mono text-ink-muted">{booking.id}</span>
            </div>
            <div className="flex justify-between text-sm text-ink">
              <span>₹{booking.farePerSeat} × {booking.seats} seat{booking.seats === 1 ? '' : 's'}</span>
              <span className="font-mono">₹{booking.totalFare.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between text-sm text-ink">
              <span>Due now · 10%</span>
              <span className="font-mono text-accent-700">₹{booking.prepaidAmount.toLocaleString('en-IN')}</span>
            </div>
            {booking.paymentOrderId && (
              <div className="flex justify-between text-xs text-ink-muted">
                <span>Payment reference</span>
                <span className="font-mono text-ink-muted">{booking.paymentOrderId}</span>
              </div>
            )}
            <span className="h-px bg-border-subtle" />

            {booking.status === 'PENDING_PAYMENT' && (
              <>
                <p className="text-xs leading-relaxed text-ink-muted">
                  Your seat is held but not yet paid for — it isn't confirmed for travel until
                  payment settles. Pay now, or check again if you already completed payment
                  elsewhere.
                </p>
                {checkoutError && <p role="alert" className="text-xs text-red-600">{checkoutError}</p>}
                {statusCheckError && <p role="alert" className="text-xs text-red-600">{statusCheckError}</p>}
                <Button
                  disabled={checkoutOpening || checkingStatus}
                  loading={checkoutOpening}
                  onClick={() => void handleOpenCheckout()}
                >
                  Pay now
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={checkoutOpening || checkingStatus}
                  loading={checkingStatus}
                  onClick={() => void handleCheckStatus()}
                >
                  Check payment status
                </Button>
              </>
            )}
            {booking.status === 'CONFIRMED' && (
              <p className="text-xs leading-relaxed text-ink-muted">Payment confirmed — this seat is booked.</p>
            )}
            {booking.status === 'PAYMENT_FAILED' && (
              <p className="text-xs leading-relaxed text-ink-muted">
                This payment failed and the seat hold was released.
              </p>
            )}
            {booking.status === 'CANCELLED' && (
              <p className="text-xs leading-relaxed text-ink-muted">This booking was cancelled.</p>
            )}
            {booking.status === 'COMPLETED' && (
              <p className="text-xs leading-relaxed text-ink-muted">This trip is complete.</p>
            )}
          </Card>
        ) : viewBookingId ? (
          // Viewing an existing booking (arrived from My Trips) — never the
          // "Book this ride" CTA, even while this is loading or failed: that
          // CTA only belongs to the separate, explicit create-a-new-booking
          // flow below.
          <Card className="flex flex-col gap-2.5 p-4">
            {viewedBookingLoading && (
              <p className="text-center text-sm text-ink-muted">Loading your booking…</p>
            )}
            {!viewedBookingLoading && viewedBookingError && (
              <>
                <p role="alert" className="text-sm text-red-600">{viewedBookingError}</p>
                <Button variant="secondary" size="sm" className="w-fit" onClick={() => loadViewedBooking(viewBookingId)}>
                  Retry
                </Button>
              </>
            )}
          </Card>
        ) : (
          <>
            {submitError && (
              <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-700">
                {submitError}
              </p>
            )}
            {!bookable && bookabilityReason && <p className="text-xs text-ink-muted">{bookabilityReason}</p>}
            <Button
              size="lg"
              className="h-14 text-base"
              disabled={submitting || !bookable}
              loading={submitting}
              onClick={() => void handleBook()}
            >
              Book this ride
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

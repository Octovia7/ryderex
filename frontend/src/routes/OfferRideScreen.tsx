import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import { withAuthRetry } from '../api/withAuthRetry';
import { listVehicles } from '../api/vehicles';
import type { Vehicle } from '../api/vehicles';
import { createRide, getRide, getRideCheckout } from '../api/rides';
import type { CreateRideInput, Ride } from '../api/rides';
import { ApiError } from '../api/client';
import { isValidCheckoutDetails, loadRazorpayCheckout } from '../api/razorpayCheckout';
import type { RazorpayCheckoutInstance } from '../api/razorpayCheckout';
import { LocationField } from '../components/LocationField';
import type { LocationValue } from '../components/LocationField';
import { upcomingKolkataDates } from '../utils/kolkataDate';

const EMPTY_LOCATION: LocationValue = { label: '', lat: null, lng: null };
const DATE_OPTIONS = upcomingKolkataDates(4);

function isEligible(vehicle: Vehicle): boolean {
  return vehicle.status === 'ACTIVE' && vehicle.verificationStatus === 'VERIFIED';
}

// India has used a fixed UTC+05:30 offset with no DST since 1945
// (utils/kolkataDate.ts's own reasoning) — the same hardcoded offset the
// backend's own date handling relies on, not a general timezone shortcut.
// `time` is a native <input type="time"> value (HH:MM); this never sends a
// raw datetime-local value, always a real ISO instant with an explicit
// offset, matching createRideSchema's z.iso.datetime({ offset: true }).
function buildDepartureIso(dateStr: string, time: string): string | null {
  if (!time) return null;
  return `${dateStr}T${time}:00+05:30`;
}

export function OfferRideScreen() {
  const session = useSession();
  const navigate = useNavigate();

  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [vehiclesError, setVehiclesError] = useState<string | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);

  const [origin, setOrigin] = useState<LocationValue>(EMPTY_LOCATION);
  const [destination, setDestination] = useState<LocationValue>(EMPTY_LOCATION);
  const [dateIndex, setDateIndex] = useState(0);
  const [time, setTime] = useState('');
  const [seats, setSeats] = useState(1);

  const [ride, setRide] = useState<Ride | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Same ref-held idempotency-key lifecycle already established on
  // RideDetailScreen's booking submit: reused across the 401-refresh retry
  // and across a NETWORK_ERROR (ambiguous whether the server saw it), reset
  // only once a definitive answer (success or any other coded error) means
  // the next click is a genuinely new attempt.
  const idempotencyKeyRef = useRef<string | null>(null);

  // Re-checks this ride's authoritative status. This is a read, never a
  // trigger: there is no endpoint the frontend can call to create or launch
  // a checkout for the posting commission, and this request cannot make a
  // payment happen — it only reflects whatever the backend's own webhook
  // has already settled.
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [statusCheckError, setStatusCheckError] = useState<string | null>(null);

  // Opening Checkout.js for the posting commission. Same synchronous guard
  // as RideDetailScreen's booking checkout: checked before any await, and
  // held true for the whole time Razorpay's modal could be open, not just
  // during setup.
  const checkoutInFlightRef = useRef(false);
  const [checkoutOpening, setCheckoutOpening] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  // The active modal, if one is open — Checkout.js attaches it directly to
  // document.body, outside React's tree, so nothing but an explicit
  // instance.close() call tears it down. Cleared whenever a checkout
  // attempt ends (any outcome) or setup fails, so it's never stale.
  const checkoutInstanceRef = useRef<RazorpayCheckoutInstance | null>(null);
  // Guards every setState below against firing after this screen has
  // unmounted — distinct from the vehicle-fetch effect's own local
  // `cancelled` flag, since this one also has to be read from inside
  // Razorpay's callbacks, which can fire long after the component that
  // registered them is gone.
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      // Close whatever modal is still open, if any — this never
      // re-enables checkoutInFlightRef or touches any state; the component
      // is gone, so there is no "allow another checkout" concern, only
      // "don't leave a floating overlay behind."
      checkoutInstanceRef.current?.close();
      checkoutInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setVehiclesLoading(true);
    setVehiclesError(null);

    (async () => {
      try {
        const { items } = await withAuthRetry(session, (token) => listVehicles(token));
        if (cancelled) return;
        setVehicles(items);
        const eligible = items.filter(isEligible);
        if (eligible.length > 0) {
          setSelectedVehicleId(eligible[0].id);
        }
      } catch (cause) {
        if (!cancelled) {
          setVehiclesError(cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.');
        }
      } finally {
        if (!cancelled) setVehiclesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Mount-once: session's identity is stable per its own context memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const eligibleVehicles = (vehicles ?? []).filter(isEligible);
  const selectedVehicle = eligibleVehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null;

  function selectVehicle(vehicle: Vehicle) {
    setSelectedVehicleId(vehicle.id);
    setSeats((current) => Math.max(1, Math.min(current, vehicle.seatCapacity)));
  }

  const departureIso = buildDepartureIso(DATE_OPTIONS[dateIndex].dateStr, time);
  const departureIsFuture = departureIso !== null && new Date(departureIso).getTime() > Date.now();

  const canSubmit =
    origin.lat !== null &&
    origin.lng !== null &&
    destination.lat !== null &&
    destination.lng !== null &&
    selectedVehicle !== null &&
    departureIso !== null &&
    departureIsFuture &&
    seats >= 1 &&
    (selectedVehicle ? seats <= selectedVehicle.seatCapacity : true);

  async function handleOffer() {
    if (!canSubmit || !selectedVehicle || !departureIso || submitting || ride) return;

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }
    const key = idempotencyKeyRef.current;

    setSubmitError(null);
    setSubmitting(true);
    try {
      const input: CreateRideInput = {
        vehicleId: selectedVehicle.id,
        originLat: origin.lat!,
        originLng: origin.lng!,
        destinationLat: destination.lat!,
        destinationLng: destination.lng!,
        departureTime: departureIso,
        totalSeats: seats,
      };
      const created = await withAuthRetry(session, (token) => createRide(input, key, token));
      idempotencyKeyRef.current = null;
      setRide(created);
    } catch (cause) {
      if (cause instanceof ApiError) {
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
    if (!ride || checkingStatus) return;
    setStatusCheckError(null);
    setCheckingStatus(true);
    try {
      const updated = await withAuthRetry(session, (token) => getRide(ride.id, token));
      if (mountedRef.current) setRide(updated);
    } catch (cause) {
      if (mountedRef.current) {
        setStatusCheckError(cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.');
      }
    } finally {
      if (mountedRef.current) setCheckingStatus(false);
    }
  }

  // Launches Razorpay Checkout.js against the EXISTING pending posting-
  // commission order — never creates a ride or a new order; only reads the
  // order's own checkout coordinates (GET /rides/:id/checkout) and opens
  // the gateway's own modal against them. Checkout.js's own callback is
  // never trusted as proof of payment; every outcome (success, failure, or
  // the user dismissing it) does the same thing: release the guard and
  // re-check the authoritative status. Only the backend's webhook confirms
  // payment.
  async function handleOpenCheckout() {
    if (!ride || checkoutInFlightRef.current) return;
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
      const details = await withAuthRetry(session, (token) => getRideCheckout(ride.id, token));

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
        description: 'Ride posting commission',
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

      // A stale order (the ride already resolved since this screen last
      // fetched it) is reported with the backend's own neutral message —
      // never recast as a payment failure — and is itself a signal worth
      // acting on: re-check status now rather than waiting for the user to
      // notice and tap "Check payment status" separately. handleCheckStatus's
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

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
      <div style={{ maxWidth: 440, margin: '0 auto', padding: '20px 16px 48px', display: 'flex', flexDirection: 'column', gap: 16 }}>
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
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>Offer a ride</h1>
        </div>

        {vehiclesLoading && (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '48px 0' }}>Loading your vehicles…</p>
        )}

        {!vehiclesLoading && vehiclesError && (
          <div style={{ padding: 16, borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--warning-border)', color: 'var(--warning)', fontSize: 14 }}>
            {vehiclesError}
          </div>
        )}

        {!vehiclesLoading && !vehiclesError && eligibleVehicles.length === 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: 20,
              borderRadius: 22,
              background: 'var(--surface-1)', boxShadow: 'var(--card-shadow)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>No verified vehicle yet</h2>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-muted)' }}>
              You need at least one vehicle that's both active and admin-verified before you can post
              a ride. Register one and upload its documents — it will appear here automatically once
              an admin verifies it.
            </p>
            <button
              type="button"
              onClick={() => navigate('/driver/vehicle')}
              style={{
                height: 48,
                borderRadius: 'var(--radius-control)',
                border: 0,
                background: 'var(--accent)',
                color: 'var(--accent-on)',
                font: '700 14px var(--font-ui)',
                cursor: 'pointer',
              }}
            >
              Register a vehicle
            </button>
          </div>
        )}

        {!vehiclesLoading && !vehiclesError && eligibleVehicles.length > 0 && !ride && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.14em', color: 'var(--text-muted)' }}>
                VEHICLE
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {eligibleVehicles.map((vehicle) => {
                  const on = vehicle.id === selectedVehicleId;
                  return (
                    <button
                      key={vehicle.id}
                      type="button"
                      onClick={() => selectVehicle(vehicle)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px 14px',
                        borderRadius: 16,
                        cursor: 'pointer',
                        textAlign: 'left',
                        background: on ? 'rgba(11,129,147,.12)' : 'var(--surface-2)',
                        border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                      }}
                    >
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ font: '600 14px var(--font-ui)' }}>{vehicle.registrationNumber}</span>
                        <span style={{ font: '400 11px var(--font-mono)', color: 'var(--text-muted)' }}>
                          {vehicle.vehicleType} · {vehicle.seatCapacity} seats{vehicle.isAc ? ' · AC' : ''}
                        </span>
                      </span>
                      {vehicle.model && (
                        <span style={{ font: '500 11px var(--font-mono)', color: 'var(--text-2)' }}>{vehicle.model}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ borderRadius: 20, background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '0 16px' }}>
              <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <LocationField
                  label="PICKUP"
                  placeholder="Where does the ride start?"
                  value={origin}
                  onChange={setOrigin}
                  dotColor="accent"
                  dotShape="circle"
                />
              </div>
              <LocationField
                label="DROP"
                placeholder="Where does the ride end?"
                value={destination}
                onChange={setDestination}
                dotColor="accent-2"
                dotShape="square"
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.14em', color: 'var(--text-muted)' }}>
                DEPARTURE DATE
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                {DATE_OPTIONS.map((option, index) => {
                  const on = index === dateIndex;
                  return (
                    <button
                      key={option.dateStr}
                      type="button"
                      onClick={() => setDateIndex(index)}
                      style={{
                        flex: 1,
                        height: 56,
                        borderRadius: 16,
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 2,
                        background: on ? 'rgba(11,129,147,.12)' : 'var(--surface-2)',
                        border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                        color: on ? 'var(--text)' : 'var(--text-2)',
                      }}
                    >
                      <span style={{ font: '600 13px var(--font-ui)' }}>{option.label}</span>
                      <span style={{ font: '500 11px var(--font-mono)', opacity: 0.8 }}>{option.sub}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.14em', color: 'var(--text-muted)' }}>
                DEPARTURE TIME
              </span>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  height: 56,
                  padding: '0 16px',
                  borderRadius: 'var(--radius-control)',
                  background: 'var(--surface-2)',
                  border: `1px solid ${time ? 'var(--accent)' : 'var(--border)'}`,
                }}
              >
                <input
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: 0,
                    outline: 'none',
                    color: 'var(--text)',
                    font: '500 16px var(--font-ui)',
                    padding: 0,
                  }}
                />
              </span>
              {time && !departureIsFuture && (
                <span style={{ fontSize: 11, color: 'var(--warning)' }}>
                  Pick a time that's still in the future for this date.
                </span>
              )}
            </label>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 6px 6px 14px',
                borderRadius: 16,
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: 14, color: 'var(--text-2)' }}>
                Seats {selectedVehicle ? `(max ${selectedVehicle.seatCapacity})` : ''}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  type="button"
                  aria-label="Fewer seats"
                  onClick={() => setSeats((s) => Math.max(1, s - 1))}
                  style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 20, cursor: 'pointer' }}
                >
                  −
                </button>
                <span style={{ width: 28, textAlign: 'center', font: '600 18px var(--font-mono)', color: 'var(--accent)' }}>{seats}</span>
                <button
                  type="button"
                  aria-label="More seats"
                  onClick={() => setSeats((s) => Math.min(selectedVehicle?.seatCapacity ?? s, s + 1))}
                  style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 20, cursor: 'pointer' }}
                >
                  +
                </button>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)' }}>
              The fare and posting commission are calculated by the backend from the real route
              distance and your vehicle type once you submit — there's no estimate shown here before
              that.
            </p>

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

            <button
              type="button"
              disabled={!canSubmit || submitting}
              onClick={() => void handleOffer()}
              style={{
                height: 58,
                borderRadius: 18,
                border: 0,
                cursor: canSubmit && !submitting ? 'pointer' : 'not-allowed',
                background: canSubmit && !submitting ? 'var(--accent)' : 'var(--surface-3)',
                color: canSubmit && !submitting ? 'var(--accent-on)' : 'var(--text-muted)',
                font: '700 16px var(--font-ui)',
                boxShadow: canSubmit && !submitting ? 'var(--accent-glow)' : 'none',
              }}
            >
              {submitting ? 'Posting…' : 'Offer this ride'}
            </button>
          </>
        )}

        {ride && (
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
              <span style={{ font: '700 16px var(--font-ui)' }}>Ride posted</span>
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
                {ride.status === 'PENDING_PAYMENT' ? 'PENDING PAYMENT' : ride.status}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--text-2)' }}>
              <span>Fare per seat</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                ₹{ride.farePerSeat.toLocaleString('en-IN')}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--text-2)' }}>
              <span>Posting commission</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>
                ₹{ride.postingCommissionAmount.toLocaleString('en-IN')}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--text-2)' }}>
              <span>Seats offered</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{ride.totalSeats}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
              <span>Payment reference</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-2)' }}>
                {ride.paymentOrderId}
              </span>
            </div>
            <span style={{ height: 1, background: 'var(--border-subtle)' }} />

            {ride.status === 'PENDING_PAYMENT' && (
              <>
                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)' }}>
                  This ride is not live or searchable yet — it stays hidden from passengers until
                  the posting commission is paid. Pay now, or check again if you already completed
                  payment elsewhere.
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
            {(ride.status === 'OPEN' || ride.status === 'FULL') && (
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)' }}>
                Payment confirmed — this ride is live and searchable by passengers.
              </p>
            )}
            {ride.status === 'CANCELLED' && (
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)' }}>
                This ride was cancelled.
              </p>
            )}
            <button
              type="button"
              onClick={() => navigate('/driver')}
              style={{
                height: 48,
                borderRadius: 'var(--radius-control)',
                border: '1px solid var(--border)',
                background: 'var(--surface-3)',
                color: 'var(--accent-2)',
                font: '600 14px var(--font-ui)',
                cursor: 'pointer',
              }}
            >
              Back to driver hub
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

import { ChevronLeft } from 'lucide-react';
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
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { cn } from '../lib/cn';

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
        <h1 className="text-xl font-semibold tracking-tight text-ink">Offer a ride</h1>
      </div>

      {vehiclesLoading && <p className="py-12 text-center text-sm text-ink-muted">Loading your vehicles…</p>}

      {!vehiclesLoading && vehiclesError && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700">
          {vehiclesError}
        </div>
      )}

      {!vehiclesLoading && !vehiclesError && eligibleVehicles.length === 0 && (
        <Card className="flex flex-col gap-2.5 p-5">
          <h2 className="text-base font-semibold text-ink">No verified vehicle yet</h2>
          <p className="text-sm text-ink-muted">
            You need at least one vehicle that's both active and admin-verified before you can post
            a ride. Register one and upload its documents — it will appear here automatically once
            an admin verifies it.
          </p>
          <Button className="mt-1" onClick={() => navigate('/driver/vehicle')}>
            Register a vehicle
          </Button>
        </Card>
      )}

      {!vehiclesLoading && !vehiclesError && eligibleVehicles.length > 0 && !ride && (
        <>
          <div className="flex flex-col gap-2.5">
            <span className="font-mono text-[10px] tracking-wider text-ink-muted">VEHICLE</span>
            <div className="flex flex-col gap-2">
              {eligibleVehicles.map((vehicle) => {
                const on = vehicle.id === selectedVehicleId;
                return (
                  <button
                    key={vehicle.id}
                    type="button"
                    onClick={() => selectVehicle(vehicle)}
                    className={cn(
                      'flex items-center justify-between rounded-lg border px-3.5 py-3 text-left transition-colors',
                      on ? 'border-accent-700 bg-accent-50' : 'border-border-strong bg-surface',
                    )}
                  >
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm font-semibold text-ink">{vehicle.registrationNumber}</span>
                      <span className="font-mono text-xs text-ink-muted">
                        {vehicle.vehicleType} · {vehicle.seatCapacity} seats{vehicle.isAc ? ' · AC' : ''}
                      </span>
                    </span>
                    {vehicle.model && (
                      <span className="font-mono text-xs text-ink-faint">{vehicle.model}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-border-strong bg-surface px-4">
            <div className="border-b border-border-subtle">
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

          <div className="flex flex-col gap-2.5">
            <span className="font-mono text-[10px] tracking-wider text-ink-muted">DEPARTURE DATE</span>
            <div className="flex gap-2">
              {DATE_OPTIONS.map((option, index) => {
                const on = index === dateIndex;
                return (
                  <button
                    key={option.dateStr}
                    type="button"
                    onClick={() => setDateIndex(index)}
                    className={cn(
                      'flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border transition-colors',
                      on ? 'border-accent-700 bg-accent-50 text-ink' : 'border-border-strong bg-surface text-ink-muted',
                    )}
                  >
                    <span className="text-sm font-semibold">{option.label}</span>
                    <span className="font-mono text-xs opacity-80">{option.sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex flex-col gap-2">
            <span className="font-mono text-[10px] tracking-wider text-ink-muted">DEPARTURE TIME</span>
            <span
              className={cn(
                'flex h-14 items-center rounded-lg border px-4',
                time ? 'border-accent-700' : 'border-border-strong',
              )}
            >
              <input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                className="flex-1 border-0 bg-transparent text-base font-medium text-ink outline-none"
              />
            </span>
            {time && !departureIsFuture && (
              <span className="text-xs text-red-600">Pick a time that's still in the future for this date.</span>
            )}
          </label>

          <div className="flex items-center justify-between rounded-xl border border-border-strong bg-surface py-1.5 pl-3.5 pr-1.5">
            <span className="text-sm text-ink">
              Seats {selectedVehicle ? `(max ${selectedVehicle.seatCapacity})` : ''}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Fewer seats"
                onClick={() => setSeats((s) => Math.max(1, s - 1))}
                className="flex size-11 items-center justify-center rounded-lg border border-border-strong bg-slate-50 text-lg text-ink"
              >
                −
              </button>
              <span className="w-7 text-center font-mono text-lg font-semibold text-accent-700">{seats}</span>
              <button
                type="button"
                aria-label="More seats"
                onClick={() => setSeats((s) => Math.min(selectedVehicle?.seatCapacity ?? s, s + 1))}
                className="flex size-11 items-center justify-center rounded-lg border border-border-strong bg-slate-50 text-lg text-ink"
              >
                +
              </button>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-ink-muted">
            The fare and posting commission are calculated by the backend from the real route
            distance and your vehicle type once you submit — there's no estimate shown here before
            that.
          </p>

          {submitError && (
            <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-700">
              {submitError}
            </p>
          )}

          <Button
            size="lg"
            className="h-14 text-base"
            disabled={!canSubmit || submitting}
            loading={submitting}
            onClick={() => void handleOffer()}
          >
            Offer this ride
          </Button>
        </>
      )}

      {ride && (
        <Card className="flex flex-col gap-2.5 border-emerald-200 bg-emerald-50/40 p-4">
          <div className="flex items-center justify-between">
            <span className="text-base font-bold text-ink">Ride posted</span>
            <span className="rounded-full border border-amber-300 bg-slate-50 px-2.5 py-1 font-mono text-xs tracking-wider text-amber-700">
              {ride.status === 'PENDING_PAYMENT' ? 'PENDING PAYMENT' : ride.status}
            </span>
          </div>
          <div className="flex justify-between text-sm text-ink">
            <span>Fare per seat</span>
            <span className="font-mono">₹{ride.farePerSeat.toLocaleString('en-IN')}</span>
          </div>
          <div className="flex justify-between text-sm text-ink">
            <span>Posting commission</span>
            <span className="font-mono text-accent-700">
              ₹{ride.postingCommissionAmount.toLocaleString('en-IN')}
            </span>
          </div>
          <div className="flex justify-between text-sm text-ink">
            <span>Seats offered</span>
            <span className="font-mono">{ride.totalSeats}</span>
          </div>
          <div className="flex justify-between text-xs text-ink-muted">
            <span>Payment reference</span>
            <span className="font-mono text-ink-muted">{ride.paymentOrderId}</span>
          </div>
          <span className="h-px bg-border-subtle" />

          {ride.status === 'PENDING_PAYMENT' && (
            <>
              <p className="text-xs leading-relaxed text-ink-muted">
                This ride is not live or searchable yet — it stays hidden from passengers until
                the posting commission is paid. Pay now, or check again if you already completed
                payment elsewhere.
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
          {(ride.status === 'OPEN' || ride.status === 'FULL') && (
            <p className="text-xs leading-relaxed text-ink-muted">
              Payment confirmed — this ride is live and searchable by passengers.
            </p>
          )}
          {ride.status === 'CANCELLED' && (
            <p className="text-xs leading-relaxed text-ink-muted">This ride was cancelled.</p>
          )}
          <Button variant="secondary" size="sm" onClick={() => navigate('/driver')}>
            Back to driver hub
          </Button>
        </Card>
      )}
    </div>
  );
}

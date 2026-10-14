import { apiFetch } from './client';
import type { BookingStatus } from './bookings';

// Verified against src/modules/ride/schemas/searchRides.schema.ts.
export const RIDE_SORTS = [
  'DEPARTURE_TIME',
  'PICKUP_DISTANCE',
  'DESTINATION_DISTANCE',
  'FARE',
  'DRIVER_RATING',
] as const;
export type RideSort = (typeof RIDE_SORTS)[number];

export interface SearchRidesParams {
  date: string; // YYYY-MM-DD
  pickupLat: number;
  pickupLng: number;
  destinationLat: number;
  destinationLng: number;
  sort?: RideSort;
  limit?: number;
  cursor?: string;
}

// Verified against src/modules/ride/services/rideSearchService.ts's
// RideSearchItemDto — deliberately lean, no route geometry or driver
// commission.
export interface RideSearchItem {
  id: string;
  departureTime: string;
  availableSeats: number;
  farePerSeat: number;
  pickupDistanceMeters: number;
  destinationDistanceMeters: number;
  driver: { id: string; name: string; ratingAverage: number | null };
  vehicle: { vehicleType: 'HATCHBACK' | 'SEDAN' | 'MUV' | 'SUV'; model: string | null; isAc: boolean };
}

export interface RideSearchPage {
  items: RideSearchItem[];
  nextCursor: string | null;
}

export function searchRides(
  params: SearchRidesParams,
  accessToken?: string | null,
): Promise<RideSearchPage> {
  const query = new URLSearchParams({
    date: params.date,
    pickupLat: String(params.pickupLat),
    pickupLng: String(params.pickupLng),
    destinationLat: String(params.destinationLat),
    destinationLng: String(params.destinationLng),
  });
  if (params.sort) query.set('sort', params.sort);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);

  return apiFetch(`/rides/search?${query.toString()}`, { accessToken });
}

// Verified against src/modules/ride/services/rideService.ts's RideDto —
// including `routeGeometry`, which the DTO actually carries even though
// earlier read-only screens here never needed it. There is no endpoint that
// joins ride + driver + vehicle; that's why RideDetailScreen also accepts an
// optional search-result summary via navigation state.
export interface Ride {
  id: string;
  driverId: string;
  vehicleId: string;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  departureTime: string;
  totalSeats: number;
  availableSeats: number;
  farePerSeat: number;
  postingCommissionAmount: number;
  routeGeometry: { lat: number; lng: number }[];
  routeDistanceMeters: number;
  routeDurationSeconds: number;
  paymentOrderId: string;
  status: 'PENDING_PAYMENT' | 'OPEN' | 'FULL' | 'STARTED' | 'COMPLETED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
}

export function getRide(id: string, accessToken?: string | null): Promise<Ride> {
  return apiFetch(`/rides/${id}`, { accessToken });
}

// Verified against src/modules/ride/services/rideService.ts's
// RideCheckoutDetails. `amount` is an integer in PAISE — Razorpay
// Checkout.js's own minor unit — and is the backend's authoritative figure
// for the EXISTING posting-commission order; nothing here recalculates it
// or creates a new order.
export interface RideCheckoutDetails {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
}

// GET /api/v1/rides/:id/checkout — driver-only server-side (404 for any
// passenger, even though GET /rides/:id itself is public-readable); 409
// CHECKOUT_NOT_AVAILABLE if the ride isn't PENDING_PAYMENT, has no order
// yet, or Razorpay isn't the active provider. A pure read.
export function getRideCheckout(
  rideId: string,
  accessToken?: string | null,
): Promise<RideCheckoutDetails> {
  return apiFetch(`/rides/${rideId}/checkout`, { accessToken });
}

// Verified against src/modules/ride/schemas/createRide.schema.ts. Unknown
// keys (farePerSeat, status, availableSeats, ...) are stripped server-side
// regardless — fare, commission and status are always derived, never sent.
export interface CreateRideInput {
  vehicleId: string;
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  // ISO-8601 instant with an explicit offset (e.g. "+05:30") — the backend
  // rejects an offset-less wall-clock string and anything not in the future.
  departureTime: string;
  totalSeats: number;
}

// POST /api/v1/rides — role-gated DRIVER server-side
// (src/modules/ride/routes.ts). Requires an `Idempotency-Key` header
// (src/middleware/idempotency.ts), the same mechanism createBooking already
// uses — the caller owns key lifetime/reuse; this function just forwards it.
export function createRide(
  input: CreateRideInput,
  idempotencyKey: string,
  accessToken?: string | null,
): Promise<Ride> {
  return apiFetch('/rides', {
    method: 'POST',
    body: input,
    accessToken,
    idempotencyKey,
  });
}

// GET /api/v1/rides/mine — every ride the caller drives, any lifecycle
// state. Scoped server-side by driverId alone
// (src/modules/ride/services/rideService.ts's getMyRides) — this can never
// return another driver's rides, and the route carries no role gate since
// a non-driver calling it would just get an empty list.
export function getMyRides(accessToken?: string | null): Promise<{ items: Ride[] }> {
  return apiFetch('/rides/mine', { accessToken });
}

// Verified against src/modules/booking/services/bookingService.ts's
// RideBookingDto (listBookingsForRide) — deliberately lean: this is a
// driver's own read of who booked their ride, not a payment or fare view.
// No farePerSeat/totalFare/prepaidAmount/paymentOrderId, no passenger
// email/phone — those are never selected server-side at all, not fetched
// and discarded here.
export interface RideBookingItem {
  id: string;
  passengerId: string;
  passengerName: string;
  seats: number;
  status: BookingStatus;
  createdAt: string;
}

export interface RideBookingPage {
  items: RideBookingItem[];
  nextCursor: string | null;
}

export interface ListRideBookingsParams {
  limit?: number;
  cursor?: string;
}

// GET /api/v1/rides/:id/bookings — role-gated DRIVER server-side; ownership
// re-checked in the service (404 RIDE_NOT_FOUND for a non-owner, same
// IDOR convention as getRideCheckout above). Newest-first, keyset-
// paginated — the exact same cursor/limit query contract GET /bookings
// already uses (src/modules/booking/schemas/listBookings.schema.ts, reused
// server-side for this route too).
export function listRideBookings(
  rideId: string,
  params: ListRideBookingsParams = {},
  accessToken?: string | null,
): Promise<RideBookingPage> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);
  const qs = query.toString();

  return apiFetch(`/rides/${rideId}/bookings${qs ? `?${qs}` : ''}`, { accessToken });
}

// POST /api/v1/rides/:id/start — ownership-scoped in the service (404 for
// a non-owner, never 403); valid only from OPEN or FULL
// (rideRepository.transitionStatus's WHERE), else 409 INVALID_RIDE_STATE.
export function startRide(id: string, accessToken?: string | null): Promise<Ride> {
  return apiFetch(`/rides/${id}/start`, { method: 'POST', accessToken });
}

// POST /api/v1/rides/:id/complete — ownership-scoped; valid only from
// STARTED (rideRepository.complete's WHERE), else 409 INVALID_RIDE_STATE.
export function completeRide(id: string, accessToken?: string | null): Promise<Ride> {
  return apiFetch(`/rides/${id}/complete`, { method: 'POST', accessToken });
}

// POST /api/v1/rides/:id/cancel — ownership-scoped; valid only from
// PENDING_PAYMENT, OPEN, or FULL (rideRepository.cancel's WHERE), else 409
// INVALID_RIDE_STATE. Cascades into every active booking on the ride
// server-side — nothing here needs to know about that, it just reflects
// whatever status comes back.
export function cancelRide(id: string, accessToken?: string | null): Promise<Ride> {
  return apiFetch(`/rides/${id}/cancel`, { method: 'POST', accessToken });
}

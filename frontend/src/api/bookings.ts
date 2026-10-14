import { apiFetch } from './client';

// Verified against prisma/schema.prisma's BookingStatus enum.
export const BOOKING_STATUSES = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'PAYMENT_FAILED',
  'CANCELLED',
  'COMPLETED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

// Verified against src/modules/booking/schemas/createBooking.schema.ts.
// pickup/drop are each optional and independently so (lat+lng together or
// neither) — the backend defaults a missing pair to the ride's own
// origin/destination. Neither is sent by this first booking step; seats is
// the only field currently collected in the UI.
export interface CreateBookingInput {
  seats: number;
  pickupLat?: number;
  pickupLng?: number;
  dropLat?: number;
  dropLng?: number;
}

// Verified against src/modules/booking/services/bookingService.ts's
// BookingDto. A freshly created booking is always PENDING_PAYMENT — nothing
// in that service path can return any other status — so callers must not
// present this as paid or travel-confirmed.
export interface Booking {
  id: string;
  rideId: string;
  passengerId: string;
  seats: number;
  farePerSeat: number;
  totalFare: number;
  prepaidAmount: number;
  pickup: { lat: number; lng: number };
  drop: { lat: number; lng: number };
  status: BookingStatus;
  paymentOrderId: string | null;
  finalPaymentOrderId: string | null;
  createdAt: string;
  updatedAt: string;
}

// POST /api/v1/rides/:id/bookings — routed on the ride resource but owned by
// the booking module; role-gated PASSENGER+DRIVER server-side
// (src/modules/ride/routes.ts). Requires an `Idempotency-Key` header
// (src/middleware/idempotency.ts) — the caller is responsible for reusing
// the same key across retries of one logical submission and minting a new
// one only for a genuinely new attempt; this function just forwards it.
export function createBooking(
  rideId: string,
  input: CreateBookingInput,
  idempotencyKey: string,
  accessToken?: string | null,
): Promise<Booking> {
  return apiFetch(`/rides/${rideId}/bookings`, {
    method: 'POST',
    body: input,
    accessToken,
    idempotencyKey,
  });
}

// GET /api/v1/bookings/:id — same BookingDto shape as creation. This is only
// ever a re-read of the booking's own authoritative status after a payment
// attempt — it never confirms payment itself; the backend's webhook does.
export function getBooking(bookingId: string, accessToken?: string | null): Promise<Booking> {
  return apiFetch(`/bookings/${bookingId}`, { accessToken });
}

// Verified against src/modules/booking/services/bookingService.ts's
// CheckoutDetails. `amount` is an integer in PAISE — Razorpay Checkout.js's
// own minor unit — and is the backend's authoritative figure for the
// EXISTING order; nothing here recalculates it or creates a new order.
export interface CheckoutDetails {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
}

// GET /api/v1/bookings/:id/checkout — passenger-only server-side (404 for
// anyone else, including the ride's driver); 409 CHECKOUT_NOT_AVAILABLE if
// the booking isn't PENDING_PAYMENT, has no order yet, or Razorpay isn't
// the active provider. A pure read — calling it never creates anything.
export function getBookingCheckout(
  bookingId: string,
  accessToken?: string | null,
): Promise<CheckoutDetails> {
  return apiFetch(`/bookings/${bookingId}/checkout`, { accessToken });
}

// POST /api/v1/bookings/:id/cancel — passenger-only server-side (same
// ownership as every other booking route; 404 for anyone else, including
// the ride's driver). Valid only from PENDING_PAYMENT or CONFIRMED, and
// only while the ride hasn't reached STARTED or COMPLETED
// (src/modules/booking/services/bookingService.ts's cancelBooking) — a
// request outside those rules is rejected with 409 BOOKING_ALREADY_CANCELLED
// or 409 BOOKING_NOT_CANCELLABLE, never silently accepted. No refund is
// issued by this action: the passenger prepayment is non-refundable for a
// self-cancellation (docs/claude.md: "non-refundable unless the driver
// cancels") — nothing in the response claims otherwise.
export function cancelBooking(bookingId: string, accessToken?: string | null): Promise<Booking> {
  return apiFetch(`/bookings/${bookingId}/cancel`, { method: 'POST', accessToken });
}

export interface ListBookingsParams {
  limit?: number;
  cursor?: string;
}

// Verified against src/modules/booking/services/bookingService.ts's
// BookingPage — newest-first, keyset-paginated, scoped server-side to the
// caller's own bookings (passengerId comes from the access token on the
// backend, never a parameter here).
export interface BookingPage {
  items: Booking[];
  nextCursor: string | null;
}

// GET /api/v1/bookings — role-gated PASSENGER+DRIVER server-side, same as
// the routes above.
export function listBookings(
  params: ListBookingsParams = {},
  accessToken?: string | null,
): Promise<BookingPage> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.cursor) query.set('cursor', params.cursor);
  const qs = query.toString();

  return apiFetch(`/bookings${qs ? `?${qs}` : ''}`, { accessToken });
}

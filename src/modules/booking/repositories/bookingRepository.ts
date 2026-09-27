import { prisma } from '../../../infrastructure/database/prismaClient';

type Client = Pick<typeof prisma, 'booking'>;

const SELECT = {
  id: true,
  rideId: true,
  passengerId: true,
  seats: true,
  farePerSeat: true,
  totalFare: true,
  prepaidAmount: true,
  pickupLat: true,
  pickupLng: true,
  dropLat: true,
  dropLng: true,
  status: true,
  paymentOrderId: true,
  finalPaymentOrderId: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface CreateBookingData {
  id: string;
  rideId: string;
  passengerId: string;
  seats: number;
  farePerSeat: number;
  totalFare: number;
  prepaidAmount: number;
  pickupLat: number;
  pickupLng: number;
  dropLat: number;
  dropLng: number;
}

// Takes a client so the service can run it in the SAME transaction as the seat
// reservation: the hold and the row that represents it commit together or not
// at all. A new booking is always PENDING_PAYMENT (the column default) with no
// payment order yet — neither is a caller's choice.
export function create(client: Client, data: CreateBookingData) {
  return client.booking.create({ data, select: SELECT });
}

export function findById(id: string) {
  return prisma.booking.findUnique({ where: { id }, select: SELECT });
}

// The support chatbot's `getMyRecentBookings` tool (architecture.md §17) —
// the caller's own, 10 most recent, newest-first. A plain read; result
// projection for the model happens in the support module, not here.
export function findRecentByPassengerId(passengerId: string, limit: number) {
  return prisma.booking.findMany({
    where: { passengerId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: SELECT,
  });
}

// Conditional UPDATE: an order is attached exactly once. `count === 0` means
// one is already attached (or the booking is gone) and nothing was overwritten.
//
// Takes a client so the service can run this in the SAME follow-up
// transaction as the Payment/Transaction rows that record this same order
// (architecture.md §11) — both are pure database writes by the time this
// runs, since the order already exists.
export async function attachPaymentOrder(
  client: Client,
  id: string,
  paymentOrderId: string,
): Promise<boolean> {
  const result = await client.booking.updateMany({
    where: { id, paymentOrderId: null },
    data: { paymentOrderId },
  });
  return result.count === 1;
}

// Passenger-initiated cancellation: a conditional UPDATE valid ONLY from
// PENDING_PAYMENT or CONFIRMED, so the guard and the write are one statement and
// two concurrent cancels cannot both apply. The passenger id is part of the
// WHERE, so ownership is enforced by the write itself, not only by a read that
// preceded it. `count === 0` means nothing was written: the booking is already
// terminal (cancelled, or otherwise finished) or is not this passenger's.
//
// Deliberately its own function rather than one shared with seat-hold expiry
// (which arrives later and is valid only from PENDING_PAYMENT): a CONFIRMED
// booking must never be touched by the expiry job, only by an explicit cancel.
//
// Takes a client so the service can run it in the SAME transaction as the seat
// release. Callers branch on the returned boolean, never on a prior read.
export async function cancel(client: Client, id: string, passengerId: string): Promise<boolean> {
  const result = await client.booking.updateMany({
    where: { id, passengerId, status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] } },
    data: { status: 'CANCELLED' },
  });
  return result.count === 1;
}

// TTL-job-initiated expiry: a conditional UPDATE valid ONLY from
// PENDING_PAYMENT — never CONFIRMED, unlike a passenger's own cancel. This is
// what makes the handler idempotent by construction: if the booking was
// confirmed (or already cancelled/failed) by the time the delayed job runs,
// nothing matches and no seat is released, however many times the job fires.
//
// No passenger id in the WHERE — the job is not acting on anyone's behalf; the
// booking id it was scheduled with is trusted, the same way a `jobId` is.
//
// Takes a client so the service can run it in the SAME transaction as the seat
// release. Callers branch on the returned boolean, never on a prior read.
export async function expireIfPending(client: Client, id: string): Promise<boolean> {
  const result = await client.booking.updateMany({
    where: { id, status: 'PENDING_PAYMENT' },
    data: { status: 'CANCELLED' },
  });
  return result.count === 1;
}

// Webhook-driven resolution: a conditional UPDATE valid ONLY from
// PENDING_PAYMENT, same as expiry — a CONFIRMED booking must never be moved
// by a (duplicate or late) webhook delivery. `outcome` decides the target
// status directly; the seat release on FAILED is the caller's job (it needs
// the ride-service boundary, which this repository never crosses).
//
// Takes a client so the webhook can run this in the SAME transaction as
// resolving the Payment/Transaction rows (architecture.md §11's "ONE
// TRANSACTION" webhook-resolution box). Callers branch on the returned
// boolean, never on a prior read.
export async function confirmPayment(
  client: Client,
  id: string,
  outcome: 'SUCCESS' | 'FAILED',
): Promise<boolean> {
  const to = outcome === 'SUCCESS' ? 'CONFIRMED' : 'PAYMENT_FAILED';
  const result = await client.booking.updateMany({
    where: { id, status: 'PENDING_PAYMENT' },
    data: { status: to },
  });
  return result.count === 1;
}

// The immutable pair a seat release needs (rideId, seats) — nothing else.
// Read inside the same transaction as confirmPayment above, not as a
// pre-transaction advisory read like cancelBooking's: both values are fixed
// at booking creation and never change, so there is no race to lose.
export function findRideAndSeats(client: Client, id: string) {
  return client.booking.findUnique({ where: { id }, select: { rideId: true, seats: true } });
}

// The driver-cancellation cascade's own snapshot of a ride's active
// bookings — read inside the cascade's transaction, then acted on by
// gating each one on ITS OWN cancelForCascade return value below, never on
// this snapshot: a booking a passenger self-cancelled a moment earlier in a
// separate, already-committed transaction must be skipped entirely, not
// double-refunded.
export function findActiveByRideId(client: Client, rideId: string) {
  return client.booking.findMany({
    where: { rideId, status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] } },
    select: { id: true, passengerId: true, seats: true, status: true, prepaidAmount: true },
  });
}

// The cascade's own conditional UPDATE — deliberately separate from the
// passenger-owned `cancel` above rather than reusing it: this one has no
// passenger id in its WHERE (the cascade acts on every affected passenger's
// booking, not one specific passenger's own), so it must never be reachable
// from the passenger-facing cancel endpoint. Valid from the same two
// source states as a passenger's own cancel (PENDING_PAYMENT, CONFIRMED).
//
// Takes a client so the cascade can run this in the SAME transaction as the
// ride's own cancellation. Callers branch on the returned boolean, never on
// the findActiveByRideId snapshot above.
export async function cancelForCascade(client: Client, id: string): Promise<boolean> {
  const result = await client.booking.updateMany({
    where: { id, status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] } },
    data: { status: 'CANCELLED' },
  });
  return result.count === 1;
}

// finalPaymentService's own snapshot, read AFTER rideRepository.complete()
// succeeds — every booking still CONFIRMED at that point owes the
// remaining 90%. Not read inside any transaction: the external createOrder()
// call that follows for each one must never sit inside one.
//
// Also reused by rideService.startRide/completeRide's own notification
// wiring (steps.md §13: "per CONFIRMED booking's passenger") — `passengerId`
// is selected for that reason.
export function findConfirmedByRideId(client: Client, rideId: string) {
  return client.booking.findMany({
    where: { rideId, status: 'CONFIRMED' },
    select: {
      id: true,
      passengerId: true,
      totalFare: true,
      prepaidAmount: true,
      finalPaymentOrderId: true,
    },
  });
}

// Conditional UPDATE: a final payment order is attached exactly once, the
// same idempotency shape as attachPaymentOrder above — `count === 0` means
// one is already attached (createFinalPaymentOrdersForRide re-invoked after
// a partial failure, most likely) and nothing was overwritten.
//
// Takes a client so the service can run this in the SAME follow-up
// transaction as the Payment/Transaction rows that record this same order.
export async function attachFinalPaymentOrder(
  client: Client,
  id: string,
  finalPaymentOrderId: string,
): Promise<boolean> {
  const result = await client.booking.updateMany({
    where: { id, finalPaymentOrderId: null },
    data: { finalPaymentOrderId },
  });
  return result.count === 1;
}

// The final-payment webhook's own conditional UPDATE — valid ONLY from
// CONFIRMED, the one state a completed ride's booking can be resolving a
// final payment from. A duplicate or late delivery finding the booking
// already COMPLETED matches nothing, the same idempotency shape as
// confirmPayment above.
//
// Takes a client so the webhook can run this in the SAME transaction as
// resolving the Payment/Transaction rows. Callers branch on the returned
// boolean, never on a prior read.
export async function completeBooking(client: Client, id: string): Promise<boolean> {
  const result = await client.booking.updateMany({
    where: { id, status: 'CONFIRMED' },
    data: { status: 'COMPLETED' },
  });
  return result.count === 1;
}

// The one immutable figure the settlement log needs — read inside the same
// transaction as completeBooking above, not as a pre-transaction advisory
// read: totalFare is fixed at booking creation and never changes, so there
// is no race to lose.
export function findTotalFare(client: Client, id: string) {
  return client.booking.findUnique({ where: { id }, select: { totalFare: true } });
}

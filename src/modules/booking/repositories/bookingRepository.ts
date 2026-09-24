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

// Conditional UPDATE: an order is attached exactly once. `count === 0` means
// one is already attached (or the booking is gone) and nothing was overwritten.
export async function attachPaymentOrder(id: string, paymentOrderId: string): Promise<boolean> {
  const result = await prisma.booking.updateMany({
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

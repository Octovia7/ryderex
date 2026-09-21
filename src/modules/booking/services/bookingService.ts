import { randomUUID } from 'node:crypto';
import type { BookingStatus } from '../../../generated/prisma/enums';
import { prisma } from '../../../infrastructure/database/prismaClient';
import type { Coordinates } from '../../../infrastructure/maps';
import { paymentProvider } from '../../../infrastructure/payments';
import { AppError } from '../../../shared/AppError';
import * as rideService from '../../ride/services/rideService';
import * as bookingRepository from '../repositories/bookingRepository';
import type { CreateBookingInput } from '../schemas/createBooking.schema';

// The passenger pays this share of the booking's total fare up front.
const PREPAYMENT_PERCENT = 10;

// The one place a booking's amounts are derived: totalFare = farePerSeat × seats,
// prepaidAmount = round(totalFare × 10%). Worked in integer paise so a fare with
// decimals (99.99 × 3) cannot pick up float noise, and the .5 boundary is decided
// exactly — the same discipline as the ride's posting commission. The amounts are
// stored on the booking and never recalculated: a later pricing change cannot
// alter what an existing booking owes.
export function calculateBookingAmounts(
  farePerSeat: number,
  seats: number,
): { totalFare: number; prepaidAmount: number } {
  const totalPaise = Math.round(farePerSeat * 100) * seats;

  return {
    totalFare: totalPaise / 100,
    // 10% of (totalPaise / 100) rupees, rounded to a whole rupee.
    prepaidAmount: Math.round((totalPaise * PREPAYMENT_PERCENT) / 10_000),
  };
}

type BookingRecord = NonNullable<Awaited<ReturnType<typeof bookingRepository.findById>>>;

export interface BookingDto {
  id: string;
  rideId: string;
  passengerId: string;
  seats: number;
  farePerSeat: number;
  totalFare: number;
  prepaidAmount: number;
  pickup: Coordinates;
  drop: Coordinates;
  status: BookingStatus;
  paymentOrderId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Money columns come back as Prisma.Decimal; converted to plain numbers here, at
// the mapping boundary, so nothing downstream (or in the JSON) knows about Decimal.
function toBookingDto(booking: BookingRecord): BookingDto {
  return {
    id: booking.id,
    rideId: booking.rideId,
    passengerId: booking.passengerId,
    seats: booking.seats,
    farePerSeat: Number(booking.farePerSeat),
    totalFare: Number(booking.totalFare),
    prepaidAmount: Number(booking.prepaidAmount),
    pickup: { lat: booking.pickupLat, lng: booking.pickupLng },
    drop: { lat: booking.dropLat, lng: booking.dropLng },
    status: booking.status,
    paymentOrderId: booking.paymentOrderId,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
}

function bookingNotFound(): AppError {
  return new AppError({
    statusCode: 404,
    code: 'BOOKING_NOT_FOUND',
    message: 'Booking not found.',
  });
}

// The seat hold IS the booking row: seats are taken when the booking is created,
// not when it is paid, because holding at payment would let two passengers reach
// a payment screen for the same last seat and turn a clean 409 into a refund.
//
//  1. Read the ride and refuse what is obviously wrong. This read is ADVISORY —
//     it exists to give a precise error (own ride, not bookable), not to protect
//     anything. Whatever it saw can change before the next step, so the
//     conditional UPDATE below is what actually decides.
//  2. One transaction: reserve the seats (a single conditional UPDATE — the lock
//     is the statement) and insert the PENDING_PAYMENT booking, priced from the
//     fare that same statement returned. If the reservation fails the outcome is
//     a RESULT VARIANT, not a throw: throwing inside an interactive transaction
//     rolls it back, and the throw belongs after the transaction has finished.
//  3. Only AFTER commit, the external call: create the prepayment order, then
//     attach its id to the booking. A payment call must never sit inside the
//     transaction — it would hold the ride's row lock (blocking every other
//     passenger) for network latency, and a rollback cannot un-create an order.
//
// If createOrder fails, the booking simply stays PENDING_PAYMENT with no order
// attached: the seat hold was already committed, and it is released by the
// seat-hold expiry that a later step adds — nothing to unwind here.
export async function createBooking(
  passengerId: string,
  rideId: string,
  input: CreateBookingInput,
): Promise<BookingDto> {
  const ride = await rideService.getRideForBooking(rideId);

  if (ride.driverId === passengerId) {
    throw new AppError({
      statusCode: 409,
      code: 'CANNOT_BOOK_OWN_RIDE',
      message: 'You cannot book a seat on your own ride.',
    });
  }

  // PENDING_PAYMENT (its commission is unconfirmed), STARTED, COMPLETED and
  // CANCELLED rides take no bookings. FULL is still let through: only the seat
  // count can say a FULL ride has no room, and the UPDATE below is where it does.
  if (ride.status !== 'OPEN' && ride.status !== 'FULL') {
    throw new AppError({
      statusCode: 409,
      code: 'RIDE_NOT_BOOKABLE',
      message: 'This ride is not open for booking.',
    });
  }

  const bookingId = randomUUID();

  const outcome = await prisma.$transaction(async (tx) => {
    const reserved = await rideService.reserveSeats(tx, rideId, input.seats);

    if (!reserved) {
      return { kind: 'no_seats' } as const;
    }

    const { totalFare, prepaidAmount } = calculateBookingAmounts(reserved.farePerSeat, input.seats);

    // A point the passenger did not supply is the ride's own origin / destination.
    const pickup =
      input.pickupLat !== undefined && input.pickupLng !== undefined
        ? { lat: input.pickupLat, lng: input.pickupLng }
        : reserved.origin;
    const drop =
      input.dropLat !== undefined && input.dropLng !== undefined
        ? { lat: input.dropLat, lng: input.dropLng }
        : reserved.destination;

    const booking = await bookingRepository.create(tx, {
      id: bookingId,
      rideId,
      passengerId,
      seats: input.seats,
      farePerSeat: reserved.farePerSeat,
      totalFare,
      prepaidAmount,
      pickupLat: pickup.lat,
      pickupLng: pickup.lng,
      dropLat: drop.lat,
      dropLng: drop.lng,
    });

    return { kind: 'created', booking } as const;
  });

  if (outcome.kind === 'no_seats') {
    throw new AppError({
      statusCode: 409,
      code: 'NO_SEATS_AVAILABLE',
      message: 'Not enough seats are available on this ride.',
    });
  }

  // Committed. The order is for the amount the booking itself recorded.
  const order = await paymentProvider.createOrder({
    amount: Number(outcome.booking.prepaidAmount),
    receipt: bookingId,
  });
  await bookingRepository.attachPaymentOrder(bookingId, order.orderId);

  const created = await bookingRepository.findById(bookingId);

  if (!created) {
    throw bookingNotFound();
  }

  return toBookingDto(created);
}

// Visible to exactly two people: the passenger who booked, and the ride's driver.
// Everyone else gets 404, never 403 — "exists but isn't yours" and "doesn't exist"
// must be indistinguishable, or a valid booking id could be probed for.
export async function getBooking(userId: string, bookingId: string): Promise<BookingDto> {
  const booking = await bookingRepository.findById(bookingId);

  if (!booking) {
    throw bookingNotFound();
  }

  if (booking.passengerId !== userId) {
    const ride = await rideService.getRideForBooking(booking.rideId);

    if (ride.driverId !== userId) {
      throw bookingNotFound();
    }
  }

  return toBookingDto(booking);
}

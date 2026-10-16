import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client';
import type { BookingStatus } from '../../../generated/prisma/enums';
import { getUniqueConstraintIndexName } from '../../../infrastructure/database/prismaErrors';
import { prisma } from '../../../infrastructure/database/prismaClient';
import type { Coordinates } from '../../../infrastructure/maps';
import { paymentProvider, providerKeyId, providerName } from '../../../infrastructure/payments';
import { scheduleBookingExpiry } from '../../../infrastructure/queue';
import { AppError } from '../../../shared/AppError';
import * as conversationService from '../../chat/services/conversationService';
import * as notificationService from '../../notification/services/notificationService';
import * as paymentRecordService from '../../payment/services/paymentRecordService';
import * as rideService from '../../ride/services/rideService';
import * as bookingRepository from '../repositories/bookingRepository';
import { cancelScheduledBookingExpiry } from './bookingExpiryService';
import type { CreateBookingInput } from '../schemas/createBooking.schema';
import type { ListBookingsQuery } from '../schemas/listBookings.schema';
import { decodeBookingCursor, encodeBookingCursor } from './bookingCursor';
import * as settlementService from './settlementService';

// A page above this is clamped, never rejected — same shape and value as
// notificationQueryService's own ceiling (a local constant, since nothing in
// the canonical docs calls for an env-configurable one here).
const MAX_LIST_LIMIT = 50;

// The passenger pays this share of the booking's total fare up front.
export const PREPAYMENT_PERCENT = 10;

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
  finalPaymentOrderId: string | null;
  pickupConfirmedAt: Date | null;
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
    finalPaymentOrderId: booking.finalPaymentOrderId,
    pickupConfirmedAt: booking.pickupConfirmedAt,
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

// The exact name of the hand-written partial unique index from migration
// 20261013090000_booking_active_per_passenger_unique (see schema.prisma's
// Booking.status comment for why it isn't declared there). Checked by name,
// never by "any P2002 inside this transaction must be this" — the booking
// row also has its own primary key, and a positive identification is what
// keeps an unrelated violation from being misclassified as ALREADY_BOOKED.
const ACTIVE_BOOKING_UNIQUE_INDEX = 'bookings_active_ride_passenger_key';

function alreadyBooked(): AppError {
  return new AppError({
    statusCode: 409,
    code: 'ALREADY_BOOKED',
    message: 'You already have an active booking for this ride.',
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
//  3. Only AFTER commit, the external call: create the prepayment order. Then,
//     in a small follow-up transaction, attach its id to the booking and
//     record the Payment/Transaction rows for it together (architecture.md
//     §11) — both are pure database writes by that point, since the order
//     already exists; only the call to create it had to stay outside any
//     transaction. A payment call must never sit inside a transaction — it
//     would hold the ride's row lock (blocking every other passenger) for
//     network latency, and a rollback cannot un-create an order.
//
// If createOrder fails, the booking simply stays PENDING_PAYMENT with no order
// attached and no Payment/Transaction rows: the seat hold was already
// committed, and it is released by the seat-hold expiry that a later step
// adds — nothing to unwind here.
export async function createBooking(
  passengerId: string,
  rideId: string,
  input: CreateBookingInput,
): Promise<BookingDto> {
  const ride = await rideService.getRideForBooking(rideId, prisma);

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

  let outcome: { kind: 'no_seats' } | { kind: 'created'; booking: BookingRecord };
  try {
    outcome = await prisma.$transaction(async (tx) => {
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

      // If this throws (the active-booking unique index below), the whole
      // transaction rolls back — the reserveSeats UPDATE above included —
      // so a rejected duplicate never leaves a seat stuck reserved.
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
  } catch (error) {
    // Not a pre-check: the unique index IS the concurrency guarantee — two
    // concurrent attempts both pass the advisory status checks above, both
    // reach this insert, and the database's own index arbitrates which one
    // commits. A pre-check here would only move the TOCTOU window, not
    // close it (the same reasoning reserveSeats' own conditional UPDATE
    // already follows, one function up).
    if (getUniqueConstraintIndexName(error) === ACTIVE_BOOKING_UNIQUE_INDEX) {
      throw alreadyBooked();
    }
    throw error;
  }

  if (outcome.kind === 'no_seats') {
    throw new AppError({
      statusCode: 409,
      code: 'NO_SEATS_AVAILABLE',
      message: 'Not enough seats are available on this ride.',
    });
  }

  // Committed. Scheduled here, before the payment call, and unconditionally:
  // this is what makes an abandoned booking self-heal even if createOrder()
  // is about to fail below — the seat hold still expires on schedule either
  // way. Neither this nor the payment call may sit inside the transaction
  // above; both are external calls, and a rollback cannot un-enqueue a job
  // any more than it can un-create a gateway order.
  await scheduleBookingExpiry(bookingId);

  // RIDE_BOOKED, to the driver (steps.md §13) — the seat hold already
  // exists at this point regardless of what the payment call below does, so
  // this is the right moment to notify: a passenger genuinely booked a seat.
  await notificationService.notifyRideBooked(ride.driverId, input.seats);

  // Lazy conversation creation (steps.md §14) — the first time this
  // passenger has a reason to talk to this ride's driver. Idempotent via the
  // (rideId, passengerId) unique constraint, so a second booking by the same
  // passenger on the same ride reuses the existing conversation. Not gated
  // on payment status, same reasoning as the notification above: either
  // party may reasonably want to talk before payment confirms.
  await conversationService.getOrCreateConversationForRide(rideId, ride.driverId, passengerId);

  // The order is for the amount the booking itself recorded.
  const order = await paymentProvider.createOrder({
    amount: Number(outcome.booking.prepaidAmount),
    receipt: bookingId,
  });

  await prisma.$transaction(async (tx) => {
    await bookingRepository.attachPaymentOrder(tx, bookingId, order.orderId);
    await paymentRecordService.recordOrder(tx, {
      rideId: null,
      bookingId,
      provider: providerName,
      providerOrderId: order.orderId,
      amount: Number(outcome.booking.prepaidAmount),
      transactionType: 'BOOKING_PREPAYMENT',
    });
  });

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
    const ride = await rideService.getRideForBooking(booking.rideId, prisma);

    if (ride.driverId !== userId) {
      throw bookingNotFound();
    }
  }

  return toBookingDto(booking);
}

export interface CheckoutDetails {
  keyId: string;
  orderId: string;
  // Integer paise — the authoritative amount the existing Razorpay order
  // was actually created with, never recomputed from anything client-sent.
  // `prepaidAmount` is locked at booking creation and is the exact same
  // value `createBooking` passed into `paymentProvider.createOrder` (which
  // itself converts rupees -> paise via `Math.round(amount * 100)` — see
  // RazorpayProvider.createOrder); reapplying that identical conversion
  // here, against that same immutable figure, reproduces the order's real
  // amount exactly, without a second query against the Payment table.
  amount: number;
  currency: 'INR';
}

function checkoutNotAvailable(): AppError {
  return new AppError({
    statusCode: 409,
    code: 'CHECKOUT_NOT_AVAILABLE',
    message: 'Checkout is not available for this booking right now.',
  });
}

// Available only to the passenger who owns this booking — never the ride's
// driver, who is not the one paying the prepayment (unlike getBooking
// above, which both may read). Same 404-not-403 IDOR convention as every
// other resource here. A pure read: no order is created or modified, so
// calling this any number of times is inherently safe.
export async function getCheckoutDetails(
  passengerId: string,
  bookingId: string,
): Promise<CheckoutDetails> {
  const booking = await bookingRepository.findById(bookingId);

  if (!booking || booking.passengerId !== passengerId) {
    throw bookingNotFound();
  }

  if (
    booking.status !== 'PENDING_PAYMENT' ||
    !booking.paymentOrderId ||
    providerName !== 'razorpay' ||
    !providerKeyId
  ) {
    throw checkoutNotAvailable();
  }

  return {
    keyId: providerKeyId,
    orderId: booking.paymentOrderId,
    amount: Math.round(Number(booking.prepaidAmount) * 100),
    currency: 'INR',
  };
}

// The support chatbot's `getMyRecentBookings` tool (architecture.md §17) —
// note there is no identity parameter for the model to supply; `userId`
// always comes from the authenticated session, never a tool argument.
export async function getMyRecentBookings(userId: string): Promise<BookingDto[]> {
  const bookings = await bookingRepository.findRecentByPassengerId(userId, 10);
  return bookings.map(toBookingDto);
}

export interface BookingPage {
  items: BookingDto[];
  // Opaque; hand it back verbatim as `cursor` to get the next page. null when
  // this is the last page.
  nextCursor: string | null;
}

// Newest-first, keyset-paginated, scoped to the caller's own bookings only —
// the exact same shape as notificationQueryService.listNotifications.
// `passengerId` comes from the authenticated session (req.user.id), never a
// query/body parameter, so this can never return another user's rows. A
// DRIVER's own past bookings-as-passenger are included on equal footing with
// a PASSENGER's, since `passengerId` is just whoever created the booking,
// regardless of role — the same "a driver is still a passenger" model the
// route guard already applies.
//
// Deliberately returns the exact same lean BookingDto as getBooking/
// cancelBooking above, not enriched with ride/driver details: joining
// against the ride module's own data here would mean either reaching into
// its repository directly (crossing the module boundary every other
// cross-module call in this codebase goes through a service for) or an
// extra service call per row inside this one list endpoint. Neither matches
// how any other list/read endpoint here is built — rideSearchService's own
// DTO is "deliberately lean" for the identical reason. A consumer that wants
// ride details already has GET /rides/:id to fetch them per item.
export async function listBookings(
  passengerId: string,
  query: ListBookingsQuery,
): Promise<BookingPage> {
  const after = query.cursor === undefined ? undefined : decodeBookingCursor(query.cursor);
  const limit = Math.min(query.limit, MAX_LIST_LIMIT);

  // One row more than the page: if it comes back, another page exists — no
  // second COUNT(*) query needed to know (same trick as rideSearchService
  // and notificationQueryService).
  const rows = await bookingRepository.findByPassengerId(prisma, passengerId, {
    limit: limit + 1,
    after,
  });

  const pageRows = rows.slice(0, limit);
  const lastRow = pageRows[pageRows.length - 1];

  const nextCursor =
    rows.length > limit && lastRow
      ? encodeBookingCursor({ createdAt: lastRow.createdAt, id: lastRow.id })
      : null;

  return { items: pageRows.map(toBookingDto), nextCursor };
}

// Deliberately lean — a driver's own read of who booked their ride
// (eventually, who they may rate per booking), never a payment or fare
// view: no fare, no payment identifiers, no passenger email/phone. All of
// those are left out at the repository's own SELECT, not fetched and
// discarded here.
export interface RideBookingDto {
  id: string;
  passengerId: string;
  passengerName: string;
  seats: number;
  status: BookingStatus;
  pickupConfirmedAt: Date | null;
  createdAt: Date;
}

export interface RideBookingPage {
  items: RideBookingDto[];
  nextCursor: string | null;
}

function rideNotFoundForOwner(): AppError {
  // Same code/message rideService's own rideNotFound() uses — this module
  // never imports that private helper, but the contract must match exactly:
  // "exists but isn't yours" and "doesn't exist" stay indistinguishable to
  // the caller regardless of which module's code path answers.
  return new AppError({ statusCode: 404, code: 'RIDE_NOT_FOUND', message: 'Ride not found.' });
}

// GET /rides/:id/bookings — routed on the ride resource (like createBooking
// above) but implemented here, since bookings are this module's own data.
// Ownership reuses rideService.getRideForBooking, the exact same minimal
// cross-module lookup createBooking already calls — the ride module never
// needs a second, bespoke "does this driver own this ride" entry point.
// 404 RIDE_NOT_FOUND for both a nonexistent ride and one that exists but
// isn't the caller's — the same 404-not-403 IDOR convention as every other
// owner-scoped resource in this codebase.
export async function listBookingsForRide(
  driverId: string,
  rideId: string,
  query: ListBookingsQuery,
): Promise<RideBookingPage> {
  const ride = await rideService.getRideForBooking(rideId, prisma);

  if (ride.driverId !== driverId) {
    throw rideNotFoundForOwner();
  }

  const after = query.cursor === undefined ? undefined : decodeBookingCursor(query.cursor);
  const limit = Math.min(query.limit, MAX_LIST_LIMIT);

  const rows = await bookingRepository.findByRideId(prisma, rideId, {
    limit: limit + 1,
    after,
  });

  const pageRows = rows.slice(0, limit);
  const lastRow = pageRows[pageRows.length - 1];

  const nextCursor =
    rows.length > limit && lastRow
      ? encodeBookingCursor({ createdAt: lastRow.createdAt, id: lastRow.id })
      : null;

  return {
    items: pageRows.map((row) => ({
      id: row.id,
      passengerId: row.passengerId,
      passengerName: row.passenger.name,
      seats: row.seats,
      status: row.status,
      pickupConfirmedAt: row.pickupConfirmedAt,
      createdAt: row.createdAt,
    })),
    nextCursor,
  };
}

// Cancel a booking and hand its seats back — ATOMICALLY: the status change and
// the seat release are one transaction, so a booking can never be cancelled with
// its seats still held (a leaked seat), nor its seats released while it stays
// live (an oversold ride).
//
//  1. Ownership. Only the passenger who made the booking may cancel it. Anyone
//     else — including the ride's driver, who may VIEW it — gets 404, never 403:
//     "exists but isn't yours" must be indistinguishable from "doesn't exist".
//     This read is advisory (it also supplies the booking's immutable `seats` and
//     `rideId`); the write below carries the passenger id in its own WHERE, so
//     ownership is enforced there too.
//  2. In one transaction: FIRST, the ride's status is re-read — HERE, inside
//     this transaction, never before it (architecture.md's "Cancellation
//     guard": reading it earlier would leave a TOCTOU window in which the
//     driver starts the ride between check and cancel, letting a passenger
//     dodge the final 90% payment collected once a ride is STARTED). A
//     booking on a ride that has reached STARTED or COMPLETED can no longer
//     be self-cancelled — rejected the same way a lost transition is (a
//     RESULT VARIANT, without even attempting the write below). Otherwise:
//     the conditional transition (PENDING_PAYMENT or CONFIRMED -> CANCELLED),
//     and only if it applied, the seat release. The release runs ONLY when
//     this call won the transition, so a booking that is already terminal is
//     a no-op — its seats are never released twice, however many cancels race.
//  3. A lost transition (including the ride-started guard above) is a RESULT
//     VARIANT, not a throw. The one deliberate throw inside the transaction
//     is a failed release: that would mean the ride could not take the seats
//     back (an invariant violation), and here the writes must NOT survive —
//     throwing rolls the cancellation back with it, so the booking is never
//     left cancelled with its seats leaked.
//
// Passenger-only, idempotent: confirms the caller is actually in the car for
// a booking that is already paid (CONFIRMED). Deliberately does NOT gate on
// the ride's own status — a passenger may confirm the moment they get in,
// whether that happens to land just before or just after the driver taps
// "start" — the only thing that matters here is a true record of whether
// THIS passenger was ever picked up, not a strict ordering against the
// ride's own lifecycle. This never blocks rideService.startRide; it exists
// so the driver's own ride-list UI can show confirmation counts before they
// choose to start, and so the record survives for a later dispute.
export async function confirmPickup(passengerId: string, bookingId: string): Promise<BookingDto> {
  const booking = await bookingRepository.findById(bookingId);

  if (!booking || booking.passengerId !== passengerId) {
    throw bookingNotFound();
  }

  const confirmed = await bookingRepository.confirmPickup(prisma, bookingId, passengerId);

  if (!confirmed) {
    // Lost the conditional UPDATE: either already confirmed (idempotent —
    // return the current state, not an error) or the booking isn't
    // CONFIRMED (never paid, already cancelled, or the ride already
    // completed and the booking moved on past CONFIRMED).
    const current = await bookingRepository.findById(bookingId);

    if (!current) {
      throw bookingNotFound();
    }

    if (current.pickupConfirmedAt !== null) {
      return toBookingDto(current);
    }

    throw new AppError({
      statusCode: 409,
      code: 'PICKUP_CONFIRMATION_NOT_AVAILABLE',
      message: 'This booking cannot be confirmed right now.',
    });
  }

  const updated = await bookingRepository.findById(bookingId);

  if (!updated) {
    throw bookingNotFound();
  }

  return toBookingDto(updated);
}

// No external call is made: refunds and forfeiture of the prepayment are not part
// of this step, and nothing is sent to a payment provider.
export async function cancelBooking(passengerId: string, bookingId: string): Promise<BookingDto> {
  const booking = await bookingRepository.findById(bookingId);

  if (!booking || booking.passengerId !== passengerId) {
    throw bookingNotFound();
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const ride = await rideService.getRideForBooking(booking.rideId, tx);

    if (ride.status === 'STARTED' || ride.status === 'COMPLETED') {
      return { kind: 'not_cancelled' } as const;
    }

    const cancelled = await bookingRepository.cancel(tx, bookingId, passengerId);

    if (!cancelled) {
      return { kind: 'not_cancelled' } as const;
    }

    const released = await rideService.releaseSeats(tx, booking.rideId, booking.seats);

    if (!released) {
      throw new Error(`Seat release failed for booking ${bookingId}; cancellation rolled back.`);
    }

    return { kind: 'cancelled' } as const;
  });

  if (outcome.kind === 'not_cancelled') {
    // Only now, to choose the error: someone else already cancelled it, or it is
    // in a state that cannot be cancelled. The transition above is what decided.
    const current = await bookingRepository.findById(bookingId);

    if (!current) {
      throw bookingNotFound();
    }

    if (current.status === 'CANCELLED') {
      throw new AppError({
        statusCode: 409,
        code: 'BOOKING_ALREADY_CANCELLED',
        message: 'This booking has already been cancelled.',
      });
    }

    throw new AppError({
      statusCode: 409,
      code: 'BOOKING_NOT_CANCELLABLE',
      message: 'This booking can no longer be cancelled.',
    });
  }

  const cancelledBooking = await bookingRepository.findById(bookingId);

  if (!cancelledBooking) {
    throw bookingNotFound();
  }

  // Purely an efficiency cleanup (steps.md decision log, 2026-08-13): the
  // scheduled seat-hold expiry job is already safely idempotent either way
  // (expireIfPending only ever fires from PENDING_PAYMENT), so leaving it
  // scheduled would change nothing — this just avoids it firing pointlessly
  // against an already-CANCELLED booking. Never fatal: a transient Redis
  // failure here must not undo a cancellation that already committed.
  await cancelScheduledBookingExpiry(bookingId).catch((error) => {
    console.error(`[booking] failed to cancel the scheduled expiry job for ${bookingId}`, error);
  });

  // BOOKING_CANCELLED, to the passenger who just cancelled their own booking
  // (steps.md §13).
  await notificationService.notifyBookingCancelled(cancelledBooking.passengerId);

  return toBookingDto(cancelledBooking);
}

// Called only from the payment webhook, inside its one transaction spanning
// the Payment/Transaction resolution and this entity transition
// (architecture.md §11). PENDING_PAYMENT is the only legal source state — a
// booking reaches every other state through its own actions (passenger
// cancel, TTL expiry), never through a payment result arriving twice.
//
// On FAILED, the seat hold must be released — through the ride-service
// boundary, exactly like cancelBooking and the expiry job — but only if this
// call actually won the transition: a booking already moved on (expired,
// cancelled, or resolved by an earlier duplicate delivery) must not have its
// seats released a second time.
export async function resolvePaymentOutcome(
  tx: Prisma.TransactionClient,
  bookingId: string,
  outcome: 'SUCCESS' | 'FAILED',
): Promise<boolean> {
  const booking = await bookingRepository.findRideAndSeats(tx, bookingId);

  if (!booking) {
    // Should not happen: the Payment row's own bookingId always references a
    // real booking (recordOrder wrote them together). Nothing to apply.
    return false;
  }

  const applied = await bookingRepository.confirmPayment(tx, bookingId, outcome);

  if (applied && outcome === 'FAILED') {
    const released = await rideService.releaseSeats(tx, booking.rideId, booking.seats);

    if (!released) {
      throw new Error(
        `Seat release failed for booking ${bookingId} on payment failure; webhook rolled back.`,
      );
    }
  }

  return applied;
}

// Called only from the payment webhook, for a FINAL_PAYMENT transaction
// (steps.md §12), inside its one transaction spanning the Payment/
// Transaction resolution and this entity transition. CONFIRMED is the only
// legal source state — the ride has already reached COMPLETED by the time
// this can ever fire (completeRide is what creates the order in the first
// place), so there is no seat to release either way.
//
// FAILED gets no status transition at all: the ride already happened, and
// there is nothing to unwind (steps.md §12: "logged for manual follow-up (no
// seat to release, ride already happened)"). Returning `true` here is
// deliberate, not a claim that anything applied — it tells the webhook's own
// generic "needs manual review" log to stay quiet, since this branch already
// logs its own, more specific message.
export async function resolveFinalPaymentOutcome(
  tx: Prisma.TransactionClient,
  bookingId: string,
  outcome: 'SUCCESS' | 'FAILED',
): Promise<boolean> {
  if (outcome === 'FAILED') {
    console.error(
      `[finalPayment] final payment failed for booking ${bookingId}; needs manual follow-up.`,
    );
    return true;
  }

  const booking = await bookingRepository.findTotalFare(tx, bookingId);
  const applied = await bookingRepository.completeBooking(tx, bookingId);

  if (applied && booking) {
    // The one place the 3%/97% split is computed (architecture.md
    // "Settlement") — logged, never persisted: no wallet/payout table is in
    // scope, and TransactionType is a closed enum.
    const settlement = settlementService.calculateSettlement(Number(booking.totalFare));
    console.log(
      `[settlement] booking ${bookingId} completed: ` +
        `platformCommission=${settlement.platformCommission} driverShare=${settlement.driverShare}`,
    );
  }

  return applied;
}

// Called only from rideService.cancelRide's driver-cancellation cascade,
// inside its own transaction (steps.md §12): finds every still-active
// booking on the ride and cancels each one, gating strictly on THAT
// booking's own cancelForCascade return value — never on the
// findActiveByRideId snapshot — so a booking a passenger self-cancelled a
// moment earlier in a separate, already-committed transaction is skipped
// entirely: never double-refunded, never double-released.
//
// A CONFIRMED booking's 10% prepayment is refunded in full (§34: driver
// cancellation is the one case it is) — recorded as a PENDING REFUND
// transaction here; its id is collected so the caller can schedule the
// actual gateway call (a later, separate, external-call step, per
// architecture.md's "external calls never belong inside a transaction")
// AFTER this transaction commits. A PENDING_PAYMENT one gets no refund —
// nothing was captured — but its scheduled seat-hold expiry job is now
// pointless; its id is returned so the caller can cancel that job, also
// after commit.
export interface CascadeCancelResult {
  bookingIdsNeedingExpiryCancel: string[];
  refundTransactionIds: string[];
  // Every passenger whose booking THIS cascade actually cancelled (steps.md
  // §13: "rideService.cancelRide cascade → RIDE_CANCELLED per affected
  // passenger") — collected here since the caller runs after commit, and
  // this is the one place that knows which bookings really applied.
  affectedPassengerIds: string[];
}

export async function cancelActiveBookingsForRide(
  tx: Prisma.TransactionClient,
  rideId: string,
): Promise<CascadeCancelResult> {
  const activeBookings = await bookingRepository.findActiveByRideId(tx, rideId);
  const bookingIdsNeedingExpiryCancel: string[] = [];
  const refundTransactionIds: string[] = [];
  const affectedPassengerIds: string[] = [];

  for (const booking of activeBookings) {
    const cancelled = await bookingRepository.cancelForCascade(tx, booking.id);

    if (!cancelled) {
      // Already moved on (a concurrent passenger self-cancel, most likely) —
      // skip entirely. Its seats were already released by whichever
      // transaction actually cancelled it.
      continue;
    }

    const released = await rideService.releaseSeats(tx, rideId, booking.seats);

    if (!released) {
      throw new Error(
        `Seat release failed for booking ${booking.id} during ride cancellation cascade; rolled back.`,
      );
    }

    affectedPassengerIds.push(booking.passengerId);

    if (booking.status === 'CONFIRMED') {
      const refund = await paymentRecordService.recordRefundForBooking(
        tx,
        booking.id,
        Number(booking.prepaidAmount),
      );
      refundTransactionIds.push(refund.id);
    } else {
      bookingIdsNeedingExpiryCancel.push(booking.id);
    }
  }

  return { bookingIdsNeedingExpiryCancel, refundTransactionIds, affectedPassengerIds };
}

// A thin, non-fatal pass-through so rideService.cancelRide's cascade only
// ever needs to import this one file from the booking module (never
// bookingExpiryService directly) — the same one-file cross-module surface
// every other module boundary in this codebase already keeps. Called AFTER
// the cascade's transaction commits, for every id cancelActiveBookingsForRide
// returned above; each job is cancelled independently so one Redis hiccup
// never affects the others.
export async function cancelScheduledExpiryJobs(bookingIds: string[]): Promise<void> {
  await Promise.all(
    bookingIds.map((bookingId) =>
      cancelScheduledBookingExpiry(bookingId).catch((error) => {
        console.error(
          `[booking] failed to cancel the scheduled expiry job for ${bookingId}`,
          error,
        );
      }),
    ),
  );
}

// rideService.startRide/completeRide's own lookup (steps.md §13: "per
// CONFIRMED booking's passenger"), reusing the exact same repository read
// finalPaymentService already uses for a different purpose — the booking
// module still never lets ride module reach into bookingRepository
// directly, only through this service.
export async function getConfirmedPassengerIds(rideId: string): Promise<string[]> {
  const bookings = await bookingRepository.findConfirmedByRideId(prisma, rideId);
  return bookings.map((booking) => booking.passengerId);
}

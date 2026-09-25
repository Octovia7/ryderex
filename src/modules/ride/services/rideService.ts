import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../generated/prisma/client';
import type { RideStatus } from '../../../generated/prisma/enums';
import { prisma } from '../../../infrastructure/database/prismaClient';
import { mapProvider } from '../../../infrastructure/maps';
import type { Coordinates } from '../../../infrastructure/maps';
import { paymentProvider, providerName } from '../../../infrastructure/payments';
import { AppError } from '../../../shared/AppError';
import * as bookingService from '../../booking/services/bookingService';
import * as paymentRecordService from '../../payment/services/paymentRecordService';
import * as userService from '../../user/services/userService';
import * as rideRepository from '../repositories/rideRepository';
import type { RideRecord } from '../repositories/rideRepository';
import type { CreateRideInput } from '../schemas/createRide.schema';
import { calculateDriverCancellationRefund } from './cancellationPolicyService';
import { calculatePostingCommission } from './commissionService';
import { calculateFare } from './fareService';
import { assertVehicleEligibleForRide } from './vehicleEligibilityService';

export interface RideDto {
  id: string;
  driverId: string;
  vehicleId: string;
  origin: Coordinates;
  destination: Coordinates;
  departureTime: Date;
  totalSeats: number;
  availableSeats: number;
  farePerSeat: number;
  postingCommissionAmount: number;
  routeGeometry: Coordinates[];
  routeDistanceMeters: number;
  routeDurationSeconds: number;
  paymentOrderId: string;
  status: RideStatus;
  createdAt: Date;
  updatedAt: Date;
}

function toRideDto(ride: RideRecord): RideDto {
  return {
    id: ride.id,
    driverId: ride.driverId,
    vehicleId: ride.vehicleId,
    origin: { lat: ride.originLat, lng: ride.originLng },
    destination: { lat: ride.destinationLat, lng: ride.destinationLng },
    departureTime: ride.departureTime,
    totalSeats: ride.totalSeats,
    availableSeats: ride.availableSeats,
    farePerSeat: ride.farePerSeat,
    postingCommissionAmount: ride.postingCommissionAmount,
    routeGeometry: ride.routeGeometry,
    routeDistanceMeters: ride.routeDistanceMeters,
    routeDurationSeconds: ride.routeDurationSeconds,
    paymentOrderId: ride.paymentOrderId,
    status: ride.status,
    createdAt: ride.createdAt,
    updatedAt: ride.updatedAt,
  };
}

function rideNotFound(): AppError {
  return new AppError({ statusCode: 404, code: 'RIDE_NOT_FOUND', message: 'Ride not found.' });
}

// Every external call — the route, then the payment order — happens BEFORE
// the database write, never inside it: a transaction holds a pooled
// connection and row locks, and a rollback cannot un-create a gateway order.
// The accepted trade-off is the reverse failure: if the insert fails after
// the order was created, an orphan order exists — but nothing has been
// charged either way, and a provider failure earlier leaves no ride behind.
//
// The ride INSERT and its Payment/Transaction rows are one transaction
// (architecture.md §11: "called from inside the same DB transaction as the
// ride/booking INSERT for ride creation") — both are pure database writes
// by the time this runs, since the order already exists.
//
// Fare, commission and the ride's status are all derived here. Nothing of
// the kind is ever read from the request body.
export async function createRide(driverId: string, input: CreateRideInput): Promise<RideDto> {
  const { vehicleType } = await assertVehicleEligibleForRide(
    driverId,
    input.vehicleId,
    input.totalSeats,
  );

  const origin = { lat: input.originLat, lng: input.originLng };
  const destination = { lat: input.destinationLat, lng: input.destinationLng };
  const route = await mapProvider.getRoute(origin, destination);

  // The driver's own rating (null when unrated) feeds the bounded rating
  // multiplier — never the passenger figure.
  const driver = await userService.getProfile(driverId);
  const farePerSeat = calculateFare({
    distanceMeters: route.distanceMeters,
    vehicleType,
    driverRating: driver.driverRatingAverage,
  });
  const postingCommissionAmount = calculatePostingCommission(farePerSeat, input.totalSeats);

  // The ride id is minted up front so the gateway receipt can reference it.
  const rideId = randomUUID();
  const order = await paymentProvider.createOrder({
    amount: postingCommissionAmount,
    receipt: rideId,
  });

  const ride = await prisma.$transaction(async (tx) => {
    const created = await rideRepository.create(tx, {
      id: rideId,
      driverId,
      vehicleId: input.vehicleId,
      origin,
      destination,
      departureTime: input.departureTime,
      totalSeats: input.totalSeats,
      farePerSeat,
      postingCommissionAmount,
      routeGeometry: route.routeGeometry,
      routeDistanceMeters: Math.round(route.distanceMeters),
      routeDurationSeconds: Math.round(route.durationSeconds),
      paymentOrderId: order.orderId,
    });

    await paymentRecordService.recordOrder(tx, {
      rideId: created.id,
      bookingId: null,
      provider: providerName,
      providerOrderId: order.orderId,
      amount: postingCommissionAmount,
      transactionType: 'DRIVER_RIDE_FEE',
    });

    return created;
  });

  return toRideDto(ride);
}

// Rides are readable by any authenticated user — unlike vehicles, they are
// meant to be discovered — so there is no ownership check here.
export async function getRide(rideId: string): Promise<RideDto> {
  const ride = await rideRepository.findById(rideId);

  if (!ride) {
    throw rideNotFound();
  }

  return toRideDto(ride);
}

// "Exists but isn't yours" and "doesn't exist" are indistinguishable to the
// caller, so a non-owner always gets 404 — never 403 — and a ride's
// existence is never leaked to other drivers.
async function assertOwnRide(driverId: string, rideId: string): Promise<void> {
  const ride = await rideRepository.findStatusById(rideId);

  if (!ride || ride.driverId !== driverId) {
    throw rideNotFound();
  }
}

// Ownership first (404), then the conditional transition (409). The
// transition's WHERE enumerates every legal source state, so two concurrent
// requests can never both apply, and an illegal one writes nothing.
async function transitionOwnRide(
  driverId: string,
  rideId: string,
  from: RideStatus[],
  to: RideStatus,
  action: string,
): Promise<RideDto> {
  await assertOwnRide(driverId, rideId);

  const transitioned = await rideRepository.transitionStatus(prisma, rideId, from, to);

  if (!transitioned) {
    throw new AppError({
      statusCode: 409,
      code: 'INVALID_RIDE_STATE',
      message: `This ride cannot be ${action} from its current state.`,
    });
  }

  return getRide(rideId);
}

export function startRide(driverId: string, rideId: string): Promise<RideDto> {
  return transitionOwnRide(driverId, rideId, ['OPEN', 'FULL'], 'STARTED', 'started');
}

export function completeRide(driverId: string, rideId: string): Promise<RideDto> {
  return transitionOwnRide(driverId, rideId, ['STARTED'], 'COMPLETED', 'completed');
}

// The driver-cancellation cascade (steps.md §12/architecture.md §12): unlike
// start/complete, this does not go through transitionOwnRide — cancelling a
// ride cascades into every active booking on it and, possibly, a refund of
// the driver's own posting commission, none of which the generic
// owner-scoped transition helper does.
//
//  1. Ownership + the fields the refund policy needs (postingCommissionAmount,
//     departureTime) in one read — "exists but isn't yours" and "doesn't
//     exist" stay indistinguishable (404, never 403).
//  2. The refund policy is computed here, BEFORE opening a transaction: it is
//     pure arithmetic (architecture.md §12), so there is nothing to gain by
//     deferring it, and it must be known either way before the transaction
//     decides whether to act on it.
//  3. ONE transaction: conditionally cancel the ride (rideRepository.cancel);
//     if that applied, cascade into every active booking on it
//     (bookingService.cancelActiveBookingsForRide — the booking module still
//     never reached into from rideRepository, only through its own service);
//     then, only if the policy says a driver refund is owed, record one
//     (paymentRecordService.recordRefundForRide — itself a no-op if the
//     commission was never actually captured, e.g. a ride cancelled while
//     still PENDING_PAYMENT).
//  4. A lost cancellation is a RESULT VARIANT, not a throw — the same
//     "throwing inside a transaction rolls it back; return a variant, throw
//     after" discipline used everywhere else in this codebase.
//  5. Only AFTER commit: cancel the scheduled BullMQ expiry job for every
//     booking that was still PENDING_PAYMENT (an external Redis call, so it
//     can never sit inside the transaction above) — non-fatal, and purely an
//     efficiency cleanup, exactly like cancelBooking's own equivalent step.
//
// The actual refund gateway call is deliberately NOT made here: external
// calls never belong inside a transaction, and processing the PENDING
// REFUND transactions this creates is separate work.
export async function cancelRide(driverId: string, rideId: string): Promise<RideDto> {
  const ride = await rideRepository.findById(rideId);

  if (!ride || ride.driverId !== driverId) {
    throw rideNotFound();
  }

  const policy = calculateDriverCancellationRefund(
    ride.postingCommissionAmount,
    ride.departureTime,
  );

  const outcome = await prisma.$transaction(async (tx) => {
    const cancelled = await rideRepository.cancel(tx, rideId);

    if (!cancelled) {
      return { kind: 'not_cancelled' } as const;
    }

    const { bookingIdsNeedingExpiryCancel } = await bookingService.cancelActiveBookingsForRide(
      tx,
      rideId,
    );

    if (policy.refundAmount > 0) {
      await paymentRecordService.recordRefundForRide(tx, rideId, policy.refundAmount);
    }

    return { kind: 'cancelled', bookingIdsNeedingExpiryCancel } as const;
  });

  if (outcome.kind === 'not_cancelled') {
    throw new AppError({
      statusCode: 409,
      code: 'INVALID_RIDE_STATE',
      message: 'This ride cannot be cancelled from its current state.',
    });
  }

  await bookingService.cancelScheduledExpiryJobs(outcome.bookingIdsNeedingExpiryCancel);

  return getRide(rideId);
}

// What another module (booking) may know about a ride: who drives it and
// whether it is bookable. Deliberately not the whole ride — nothing else about
// it is that module's business, and no repository crosses the module boundary.
export async function getRideForBooking(
  rideId: string,
): Promise<{ id: string; driverId: string; status: RideStatus }> {
  const ride = await rideRepository.findStatusById(rideId);

  if (!ride) {
    throw rideNotFound();
  }

  return ride;
}

// Seat allocation stays the ride module's concern (it owns `available_seats` and
// the OPEN/FULL flip). The booking module composes these into ITS transaction by
// passing the transaction client through, so the seat change and the booking
// write commit or roll back together — without reaching into rideRepository.
export function reserveSeats(tx: Prisma.TransactionClient, rideId: string, seats: number) {
  return rideRepository.reserveSeats(tx, rideId, seats);
}

export function releaseSeats(tx: Prisma.TransactionClient, rideId: string, seats: number) {
  return rideRepository.releaseSeats(tx, rideId, seats);
}

// Called only from the payment webhook (architecture.md §11: "ride/booking
// transition by transaction type", inside the same transaction as resolving
// the Payment/Transaction rows). `PENDING_PAYMENT` is the only legal source
// state for a driver's posting-fee outcome — a ride reaches every other
// state through its own owner-scoped actions (start/complete/cancel), never
// through a payment result.
export function resolvePostingFeeOutcome(
  tx: Prisma.TransactionClient,
  rideId: string,
  outcome: 'SUCCESS' | 'FAILED',
): Promise<boolean> {
  const to = outcome === 'SUCCESS' ? 'OPEN' : 'CANCELLED';
  return rideRepository.transitionStatus(tx, rideId, ['PENDING_PAYMENT'], to);
}

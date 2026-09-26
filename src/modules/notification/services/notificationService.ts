import { randomUUID } from 'node:crypto';
import type { NotificationType } from '../../../generated/prisma/enums';
import { prisma } from '../../../infrastructure/database/prismaClient';
import { pushProvider } from '../../../infrastructure/fcm';
import { scheduleNotificationDelivery } from '../../../infrastructure/queue';
import type { DeliverNotificationJobData } from '../../../infrastructure/queue';
import * as notificationRepository from '../repositories/notificationRepository';
import * as userDeviceRepository from '../repositories/userDeviceRepository';

// One `notify*` function per NotificationType (architecture.md §15: "each
// NotificationType owns its own title/body copy rather than a shared
// template registry with a single call site apiece"). Every one of them
// only ever enqueues a BullMQ job — never sends a push directly — so a
// caller anywhere in the codebase can call these synchronously from a
// request handler without holding up the response on FCM.
//
// Deliberately never throws: a notification is never allowed to fail the
// business operation that triggered it (booking a seat, resolving a
// payment, ...). A failure to even enqueue is logged and swallowed here,
// once, so no call site needs its own try/catch.
async function enqueueNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
): Promise<void> {
  const notificationId = randomUUID();

  try {
    await scheduleNotificationDelivery({ notificationId, userId, type, title, body });
  } catch (error) {
    console.error(
      `[notification] failed to enqueue a ${type} notification for user ${userId}`,
      error,
    );
  }
}

export function notifyRideBooked(driverId: string, seats: number): Promise<void> {
  return enqueueNotification(
    driverId,
    'RIDE_BOOKED',
    'New booking',
    `A passenger booked ${seats} seat${seats === 1 ? '' : 's'} on your ride.`,
  );
}

export function notifyBookingConfirmed(passengerId: string): Promise<void> {
  return enqueueNotification(
    passengerId,
    'BOOKING_CONFIRMED',
    'Booking confirmed',
    'Your booking is confirmed. Have a great ride!',
  );
}

export function notifyBookingCancelled(passengerId: string): Promise<void> {
  return enqueueNotification(
    passengerId,
    'BOOKING_CANCELLED',
    'Booking cancelled',
    'Your booking has been cancelled.',
  );
}

export function notifyRideCancelled(passengerId: string): Promise<void> {
  return enqueueNotification(
    passengerId,
    'RIDE_CANCELLED',
    'Ride cancelled',
    'The driver has cancelled this ride.',
  );
}

export function notifyRideStarting(passengerId: string): Promise<void> {
  return enqueueNotification(
    passengerId,
    'RIDE_STARTING',
    'Ride starting',
    'Your ride is starting now.',
  );
}

export function notifyRideCompleted(passengerId: string): Promise<void> {
  return enqueueNotification(
    passengerId,
    'RIDE_COMPLETED',
    'Ride completed',
    'Your ride has been completed. Thanks for riding with us!',
  );
}

export function notifyPaymentSuccess(userId: string, amount: number): Promise<void> {
  return enqueueNotification(
    userId,
    'PAYMENT_SUCCESS',
    'Payment successful',
    `Your payment of ₹${amount} was successful.`,
  );
}

export function notifyPaymentFailed(userId: string, amount: number): Promise<void> {
  return enqueueNotification(
    userId,
    'PAYMENT_FAILED',
    'Payment failed',
    `Your payment of ₹${amount} could not be processed.`,
  );
}

export function notifyRefundProcessed(userId: string, amount: number): Promise<void> {
  return enqueueNotification(
    userId,
    'REFUND_PROCESSED',
    'Refund processed',
    `Your refund of ₹${amount} has been processed.`,
  );
}

// The BullMQ worker's own handler (architecture.md §15, spec §46 "FCM
// delivery and notification persistence are separate concerns"):
//
//  1. Persist the in-app row FIRST — `upsert` by the same id the job was
//     enqueued with, idempotent by construction, so a retry's persistence
//     step is a no-op rather than a duplicate row. A push failure below can
//     never prevent this row from existing.
//  2. Fetch the recipient's current device tokens and attempt delivery.
//     Left to THROW on a genuine gateway-level failure so BullMQ's
//     retry/backoff (attempts: 5, exponential) retries the WHOLE job — safe
//     because step 1 already is idempotent. FCM-reported invalid tokens are
//     removed BEFORE that throw, so the retry sees a shorter list
//     (architecture.md §15).
export async function processNotificationJob(data: DeliverNotificationJobData): Promise<void> {
  await notificationRepository.upsert(prisma, {
    id: data.notificationId,
    userId: data.userId,
    type: data.type,
    title: data.title,
    body: data.body,
  });

  const tokens = await userDeviceRepository.findTokensByUserId(prisma, data.userId);

  if (tokens.length === 0) {
    return;
  }

  const results = await pushProvider.send(tokens, { title: data.title, body: data.body });

  const invalidTokens = results
    .filter((result) => result.invalidToken)
    .map((result) => result.token);

  if (invalidTokens.length > 0) {
    await userDeviceRepository.removeTokens(prisma, invalidTokens);
  }

  const retriableFailure = results.find((result) => result.retriable);

  if (retriableFailure) {
    throw new Error(
      `Push delivery failed for notification ${data.notificationId} ` +
        `(token ${retriableFailure.token.slice(0, 8)}..., len ${retriableFailure.token.length}): ` +
        `${retriableFailure.errorCode}`,
    );
  }
}

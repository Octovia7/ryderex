import { Queue } from 'bullmq';
import type { NotificationType } from '../../generated/prisma/enums';
import { queueConnection } from './queueConnection';

export const NOTIFICATION_QUEUE_NAME = 'notification';
export const DELIVER_NOTIFICATION_JOB_NAME = 'deliver-notification';

// The full payload the worker needs to both persist the in-app row AND
// attempt delivery — the Notification row does not exist yet when this is
// enqueued, so title/body/type travel with the job rather than being
// re-derived by the worker.
export interface DeliverNotificationJobData {
  notificationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
}

// Shares `queueConnection` with the other Queues (architecture.md's
// connection topology: "all 3 Queues share this") — only Workers each need
// their own connection, never Queues.
export const notificationQueue = new Queue<DeliverNotificationJobData>(NOTIFICATION_QUEUE_NAME, {
  connection: queueConnection,
});

// `jobId = notificationId` (architecture.md's BullMQ table: "9 business
// events | pre-generated UUID") is the natural key BullMQ dedupes on — the
// same id notificationService generated at *enqueue* time (never inside the
// worker, which would differ per attempt and produce duplicate rows).
//
// `attempts: 5` with exponential backoff from 5s (architecture.md's BullMQ
// table: "5, exponential from 5 s"): a genuine push-gateway failure retries
// the whole job — safe because the worker's own persistence step is
// idempotent by this same id.
export function scheduleNotificationDelivery(data: DeliverNotificationJobData) {
  return notificationQueue.add(DELIVER_NOTIFICATION_JOB_NAME, data, {
    jobId: data.notificationId,
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
  });
}

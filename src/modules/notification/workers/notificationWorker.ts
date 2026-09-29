import { Worker } from 'bullmq';
import {
  createWorkerConnection,
  DELIVER_NOTIFICATION_JOB_NAME,
  NOTIFICATION_QUEUE_NAME,
  workerPollingOptions,
} from '../../../infrastructure/queue';
import type { DeliverNotificationJobData } from '../../../infrastructure/queue';
import { processNotificationJob } from '../services/notificationService';

// Mirrors bookingExpiryWorker/refundWorker exactly (architecture.md: "each
// Worker gets its OWN connection" — never shared with the Queue or any
// other Worker, since a Worker sits in a blocking BZPOPMIN for as long as
// the process runs, and a blocking command monopolises its socket).
export function createNotificationWorker(): Worker<DeliverNotificationJobData> {
  const worker = new Worker<DeliverNotificationJobData>(
    NOTIFICATION_QUEUE_NAME,
    async (job) => {
      if (job.name !== DELIVER_NOTIFICATION_JOB_NAME) {
        // Defensive: no other job name is ever added to this queue.
        return;
      }

      await processNotificationJob(job.data);
    },
    { connection: createWorkerConnection(), ...workerPollingOptions },
  );

  worker.on('failed', (job, error) => {
    console.error(`[notification] job ${job?.id ?? '(unknown)'} failed`, error);
  });

  return worker;
}

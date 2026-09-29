import { Worker } from 'bullmq';
import {
  BOOKING_EXPIRY_QUEUE_NAME,
  createWorkerConnection,
  EXPIRE_BOOKING_JOB_NAME,
  workerPollingOptions,
} from '../../../infrastructure/queue';
import type { ExpireBookingJobData } from '../../../infrastructure/queue';
import { processBookingExpiry } from '../services/bookingExpiryService';

// Runs inside the same process as the API server for now — Redis holds all
// job state, so any instance could pick up any job, and this doesn't break
// statelessness. Given its own connection (never shared with the Queue or any
// other Worker): it sits in a blocking BZPOPMIN for as long as the process
// runs, and a blocking command monopolises its socket.
export function createBookingExpiryWorker(): Worker<ExpireBookingJobData> {
  const worker = new Worker<ExpireBookingJobData>(
    BOOKING_EXPIRY_QUEUE_NAME,
    async (job) => {
      if (job.name !== EXPIRE_BOOKING_JOB_NAME) {
        // Defensive: no other job name is ever added to this queue.
        return;
      }

      await processBookingExpiry(job.data.bookingId);
    },
    { connection: createWorkerConnection(), ...workerPollingOptions },
  );

  worker.on('failed', (job, error) => {
    console.error(`[booking-expiry] job ${job?.id ?? '(unknown)'} failed`, error);
  });

  return worker;
}

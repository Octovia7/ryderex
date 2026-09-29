import { Worker } from 'bullmq';
import {
  createWorkerConnection,
  PROCESS_REFUND_JOB_NAME,
  REFUND_QUEUE_NAME,
  workerPollingOptions,
} from '../../../infrastructure/queue';
import type { RefundJobData } from '../../../infrastructure/queue';
import { processRefund } from '../services/refundService';

// Mirrors bookingExpiryWorker exactly (architecture.md: "each Worker gets
// its OWN connection" — never shared with the Queue or any other Worker,
// since a Worker sits in a blocking BZPOPMIN for as long as the process
// runs, and a blocking command monopolises its socket).
export function createRefundWorker(): Worker<RefundJobData> {
  const worker = new Worker<RefundJobData>(
    REFUND_QUEUE_NAME,
    async (job) => {
      if (job.name !== PROCESS_REFUND_JOB_NAME) {
        // Defensive: no other job name is ever added to this queue.
        return;
      }

      await processRefund(job.data.transactionId);
    },
    { connection: createWorkerConnection(), ...workerPollingOptions },
  );

  worker.on('failed', (job, error) => {
    console.error(`[refund] job ${job?.id ?? '(unknown)'} failed`, error);
  });

  return worker;
}

import { Queue } from 'bullmq';
import { queueConnection } from './queueConnection';

export const REFUND_QUEUE_NAME = 'refund';
export const PROCESS_REFUND_JOB_NAME = 'process-refund';

export interface RefundJobData {
  transactionId: string;
}

// Shares `queueConnection` with the other Queues (architecture.md's
// connection topology: "all 3 Queues share this") — only Workers each need
// their own connection, never Queues.
export const refundQueue = new Queue<RefundJobData>(REFUND_QUEUE_NAME, {
  connection: queueConnection,
});

// Scheduled once, right after the cascade that created the PENDING REFUND
// transaction commits (never from inside that transaction — enqueueing is
// itself an external Redis call). `jobId = transactionId` is the natural key
// BullMQ dedupes on, so re-scheduling the same refund is a no-op rather than
// a duplicate job (architecture.md's concurrency matrix: "Duplicate refund
// job | jobId dedupe + PENDING-only + pre-provider status re-read").
//
// `attempts: 5` with exponential backoff (architecture.md §"Refunds"): a
// genuine gateway failure retries the whole job — safe because
// refundService.processRefund's own PENDING-only guard makes every attempt,
// including a retry, idempotent by construction.
export function scheduleRefund(transactionId: string) {
  return refundQueue.add(
    PROCESS_REFUND_JOB_NAME,
    { transactionId },
    {
      jobId: transactionId,
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
    },
  );
}

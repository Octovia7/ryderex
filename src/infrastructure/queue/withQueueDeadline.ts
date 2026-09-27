import { AppError } from '../../shared/AppError';

// Phase 15 Pass 1 finding: `queueConnection` is constructed with
// `maxRetriesPerRequest: null` (BullMQ's own requirement — see
// queueConnection.ts), which means a command issued while the connection is
// silently dead (e.g. surviving a Redis container restart in a broken state)
// queues forever rather than ever rejecting. A `Queue.add()` call made from
// a request handler — after its triggering business transaction has already
// committed (scheduleBookingExpiry, scheduleRefund, every notify* producer)
// — could then hang the HTTP request indefinitely: no error, no timeout, no
// crash, and the request's Idempotency-Key (if any) permanently stuck
// IN_PROGRESS.
//
// The same "race the real call against an explicit deadline" shape already
// used by `checkReadiness.ts`'s `withDeadline` and `rateLimit.ts`'s
// FAIL_OPEN_DEADLINE_MS — but REJECTING on timeout, never failing open: a
// dropped notification or a missed seat-hold expiry is a silent data-
// integrity gap, unlike a rate-limit check, where failing open is the
// documented, deliberate choice. The caller sees a clean, thrown AppError
// through the existing error pipeline instead of a hang.
const QUEUE_ADD_DEADLINE_MS = 2000;

export class QueueUnavailableError extends AppError {
  constructor(cause?: unknown) {
    super({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Scheduling is temporarily unavailable.',
      cause,
    });
  }
}

// Wraps a single `Queue.add(...)` call (never a DB transaction — enqueueing
// is always an external Redis call in this codebase, kept outside any
// `prisma.$transaction`, so there is nothing here to roll back). The
// already-committed business write this accompanies is never undone by a
// rejection here; the caller's own error handling decides what to surface —
// this only guarantees the call itself resolves or rejects within a bound,
// never hangs.
export async function withQueueDeadline<T>(add: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new QueueUnavailableError()), QUEUE_ADD_DEADLINE_MS);
  });

  try {
    return await Promise.race([
      add.catch((cause: unknown) => Promise.reject(new QueueUnavailableError(cause))),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

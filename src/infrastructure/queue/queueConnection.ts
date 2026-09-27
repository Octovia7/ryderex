import Redis from 'ioredis';
import { config } from '../../config';

// BullMQ requires `maxRetriesPerRequest: null` on every connection it is given
// — it refuses to construct a Queue or Worker otherwise — because it manages
// its own reconnection and retry semantics around blocking commands; ioredis's
// own per-command retry ceiling would fight that. This is why it is a
// dedicated connection, never the shared `infrastructure/redis` client, whose
// `commandTimeout` exists for the opposite reason: to make a synchronous
// request handler fail fast rather than hang.
//
// Phase 15: every Redis connection this application owns needs an explicit
// `error` listener — an ioredis client is an EventEmitter, and an unhandled
// `error` event is Node's default crash-the-process behavior. `queueConnection`
// and every `createWorkerConnection()` result both route through this one
// function, so the listener only needs to exist here.
function createQueueRedisConnection(): Redis {
  const connection = new Redis(config.redis.url, { maxRetriesPerRequest: null });

  connection.on('error', (error: unknown) => {
    console.error('[redis] queue connection error', error);
  });

  return connection;
}

// Shared by every Queue (today, only `booking-expiry`). A Queue only enqueues
// and reads job metadata — it never issues a blocking command — so queues may
// safely share one connection.
export const queueConnection = createQueueRedisConnection();

// Every Worker needs its OWN connection, never this shared one and never
// another Worker's: a Worker sits in a blocking BZPOPMIN for as long as the
// process runs, and a blocking command monopolises its socket. Sharing one is
// fine while Redis is healthy, but after an outage long enough to drop the
// socket, at least one Worker's blocking loop never resumes — `isRunning()`
// still reports `true`, no error is emitted, and its queue silently fills
// forever.
export function createWorkerConnection(): Redis {
  return createQueueRedisConnection();
}

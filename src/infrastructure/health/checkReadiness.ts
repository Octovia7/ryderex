import { AppError } from '../../shared/AppError';
import { prisma } from '../database/prismaClient';
import { redis } from '../redis/redisClient';

// The pg pool has no deadline of its own, so without this a blackholed
// database would hang the readiness probe instead of answering 503 — the
// probe failing in exactly the scenario it exists for. This used to match the
// shared Redis client's 2s commandTimeout, but that figure times an
// already-open connection's command round trip, not connection establishment:
// a pool checkout that needs a fresh TCP+TLS+auth handshake against a
// cross-region hosted Postgres (e.g. Render -> a different-region Supabase
// pooler) can exceed 2s on its own, well before any query runs. 8s gives that
// handshake real headroom while still answering well inside typical
// platform request timeouts.
const DATABASE_PROBE_TIMEOUT_MS = 8000;

async function withDeadline<T>(probe: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('readiness probe timed out')), timeoutMs);
  });

  try {
    return await Promise.race([probe, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function pingDatabase(): Promise<void> {
  try {
    await withDeadline(prisma.$queryRaw`SELECT 1`, DATABASE_PROBE_TIMEOUT_MS);
  } catch (error) {
    throw new AppError({
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'The database is unavailable.',
      cause: error,
    });
  }
}

async function pingRedis(): Promise<void> {
  try {
    await redis.ping();
  } catch (error) {
    throw new AppError({
      statusCode: 503,
      code: 'REDIS_UNAVAILABLE',
      message: 'Redis is unavailable.',
      cause: error,
    });
  }
}

// Both probes run concurrently so a double outage still answers within one
// deadline. Throws the first failure in the order PostgreSQL, then Redis.
export async function checkReadiness(): Promise<void> {
  const results = await Promise.allSettled([pingDatabase(), pingRedis()]);

  for (const result of results) {
    if (result.status === 'rejected') {
      throw result.reason;
    }
  }
}

import { AppError } from '../../shared/AppError';
import { prisma } from '../database/prismaClient';
import { redis } from '../redis/redisClient';

// Matches the shared Redis client's commandTimeout. The pg pool has no deadline
// of its own, so without this a blackholed database would hang the readiness
// probe instead of answering 503 — the probe failing in exactly the scenario it
// exists for.
const PROBE_TIMEOUT_MS = 2000;

async function withDeadline<T>(probe: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('readiness probe timed out')), PROBE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([probe, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function pingDatabase(): Promise<void> {
  try {
    await withDeadline(prisma.$queryRaw`SELECT 1`);
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

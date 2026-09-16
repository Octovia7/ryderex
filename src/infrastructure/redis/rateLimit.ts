import { redis } from './redisClient';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

// A Redis outage must degrade rate limiting, never take down auth — so a
// Redis error here fails open rather than rejecting the request.
export async function checkRateLimit(
  key: string,
  windowSeconds: number,
  max: number,
): Promise<RateLimitResult> {
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }

    const ttl = await redis.ttl(key);
    const retryAfterSeconds = ttl > 0 ? ttl : windowSeconds;

    return {
      allowed: count <= max,
      remaining: Math.max(0, max - count),
      retryAfterSeconds,
    };
  } catch (error) {
    console.error('[rate-limit] Redis error, failing open', error);
    return { allowed: true, remaining: max, retryAfterSeconds: 0 };
  }
}

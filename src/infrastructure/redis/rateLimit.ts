import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../../shared/AppError';
import { redis } from './redisClient';

// One atomic INCR+EXPIRE, in a single Lua script (architecture.md §15): the
// previous two-command version could leave a counter with no TTL if the
// process died between the two calls — a permanent lockout for whoever
// owned that key. Returning the TTL in the same round trip is also what
// makes a correct Retry-After/RateLimit-Reset possible without a third call.
const RATE_LIMIT_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return { current, redis.call('TTL', KEYS[1]) }
`;

// A Redis outage must degrade rate limiting, never take down auth/rides/
// bookings with it (claude.md §8) — but a plain try/catch cannot rescue a
// genuine hang: ioredis's `enableOfflineQueue` buffers commands issued while
// disconnected rather than rejecting them, so a check against a stopped
// Redis hangs rather than throws. This races the real call against an
// explicit deadline and fails open on either a thrown error or a timeout.
const FAIL_OPEN_DEADLINE_MS = 1000;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  // Seconds until the current window resets — used directly as both
  // `RateLimit-Reset` and `Retry-After` (architecture.md §15).
  reset: number;
}

function delay(ms: number): Promise<'timeout'> {
  return new Promise((resolve) => {
    setTimeout(() => resolve('timeout'), ms);
  });
}

// The one rate-limit primitive in this codebase (architecture.md §15: "all
// now use the same rateLimit() factory... no second limiter was
// introduced") — every call site, route middleware or not (OTP, AI support
// chat, the Socket.IO gateway), calls this directly or through `rateLimit()`
// below. Never call `redis.incr`/`redis.expire` directly elsewhere.
export async function consumeRateLimit(
  key: string,
  windowSeconds: number,
  max: number,
): Promise<RateLimitResult> {
  try {
    const outcome = await Promise.race([
      redis.eval(RATE_LIMIT_SCRIPT, 1, key, windowSeconds) as Promise<[number, number]>,
      delay(FAIL_OPEN_DEADLINE_MS),
    ]);

    if (outcome === 'timeout') {
      console.error(
        `[rate-limit] Redis did not respond within ${FAIL_OPEN_DEADLINE_MS}ms for key "${key}" — failing open`,
      );
      return { allowed: true, limit: max, remaining: max, reset: 0 };
    }

    const [current, ttl] = outcome;
    const reset = ttl > 0 ? ttl : windowSeconds;

    return {
      allowed: current <= max,
      limit: max,
      remaining: Math.max(0, max - current),
      reset,
    };
  } catch (error) {
    console.error(`[rate-limit] Redis error for key "${key}" — failing open`, error);
    return { allowed: true, limit: max, remaining: max, reset: 0 };
  }
}

export interface RateLimitOptions {
  // The `ratelimit:<prefix>:<id>` key prefix (architecture.md §15) — shared
  // by every route that must draw from the same bucket (e.g. the two
  // document-upload endpoints).
  prefix: string;
  windowSeconds: number;
  max: number;
  // 'user' keys on `req.user.id` (set by `authenticate`, so this must run
  // after it); 'ip' keys on `req.ip` (respects `TRUST_PROXY`/`trust proxy`
  // exactly the way every other per-IP check in this codebase does).
  keyBy: 'user' | 'ip';
}

// Express middleware built on `consumeRateLimit` — the route-level half of
// the one shared implementation. Async and throws directly, the same
// convention `idempotency` already uses: Express 5 forwards a rejected
// promise from any handler in the chain to the error-handling middleware
// automatically.
export function rateLimit(options: RateLimitOptions): RequestHandler {
  return async function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const identifier = options.keyBy === 'user' ? req.user!.id : req.ip;
    const key = `ratelimit:${options.prefix}:${identifier}`;

    const result = await consumeRateLimit(key, options.windowSeconds, options.max);

    res.setHeader('RateLimit-Limit', String(result.limit));
    res.setHeader('RateLimit-Remaining', String(result.remaining));
    res.setHeader('RateLimit-Reset', String(result.reset));

    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.reset));
      throw new AppError({
        statusCode: 429,
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later.',
      });
    }

    next();
  };
}

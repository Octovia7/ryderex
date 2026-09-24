import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import * as idempotencyService from '../modules/payment/services/idempotencyService';
import { AppError } from '../shared/AppError';

// Required on the two endpoints that create payment orders (architecture.md
// §11): POST /rides and POST /rides/:id/bookings. Must be mounted AFTER
// `authenticate` (needs `req.user`) and AFTER `validateBody` (hashes the
// already-validated, already-coerced body — two requests that are the same
// request after validation strips unknown fields and coerces types must
// hash identically, not differ over incidental JSON formatting).
//
// Async, and deliberately throws rather than calling `next(error)`: Express
// 5 forwards a rejected promise from ANY handler in the chain — middleware or
// route handler alike — to the error-handling middleware automatically, the
// same way every async controller in this codebase already relies on it.
export async function idempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.header('Idempotency-Key');

  if (!key) {
    throw new AppError({
      statusCode: 400,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'An Idempotency-Key header is required.',
    });
  }

  // sha256(method:path:JSON(body)) — architecture.md §11's exact formula.
  // `req.originalUrl` (not `req.path`) so the hash is tied to the full
  // requested path, including any route params already resolved into it.
  const requestHash = createHash('sha256')
    .update(`${req.method}:${req.originalUrl}:${JSON.stringify(req.body)}`)
    .digest('hex');

  const result = await idempotencyService.enforce(req.user!.id, key, requestHash);

  if (result.outcome === 'conflict') {
    throw new AppError({
      statusCode: 409,
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'This Idempotency-Key was already used with a different request.',
    });
  }

  if (result.outcome === 'in_progress') {
    throw new AppError({
      statusCode: 409,
      code: 'IDEMPOTENCY_KEY_IN_PROGRESS',
      message: 'A request with this Idempotency-Key is already being processed.',
    });
  }

  if (result.outcome === 'replay') {
    // Literally 200, never the original stored status (architecture.md §11's
    // table pairs every row with an exact HTTP code — "200 with the stored
    // response" alongside the other two rows' literal 409s — not shorthand
    // for "success"). The original creation's status is still persisted
    // ("persist status + body"), just never reused as the replay's own code:
    // a replay is a cache hit, not a second creation.
    res.status(200).json(result.responseBody);
    return;
  }

  // `claimed` — this request won. Capture whatever the handler eventually
  // sends, success or error, BEFORE it reaches the socket (architecture.md
  // §11: "Response capture wraps res.json so whatever the handler sends is
  // persisted"), so a later identical request replays this exact outcome
  // rather than re-running a handler that could behave differently the
  // second time (different seat availability, a since-cancelled ride, ...).
  const { id } = result;
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    idempotencyService.complete(id, res.statusCode, body).catch((error: unknown) => {
      console.error(`[idempotency] failed to persist the response for key ${key}`, error);
    });
    return originalJson(body);
  }) as Response['json'];

  next();
}

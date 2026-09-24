import type { Request, Response } from 'express';
import { AppError } from '../../../shared/AppError';
import { sendSuccess } from '../../../shared/sendSuccess';
import * as webhookService from '../services/webhookService';

// `req.body` is a raw Buffer here, not a parsed object — the route mounts
// `express.raw()` instead of the shared `express.json()`, specifically so
// the signature can be verified against the exact bytes it was computed
// over. A response body is not required by Razorpay; sent anyway for the
// same envelope consistency every other endpoint uses.
export async function handlePaymentWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.header('X-Razorpay-Signature');
  const rawBody = req.body as unknown;

  // A non-JSON content type never reaches `express.raw({ type:
  // 'application/json' })`'s parser, so `req.body` stays whatever Express
  // left it as (undefined), not an empty Buffer. Caught here, before
  // anything downstream tries to HMAC a non-Buffer — the exact "webhook
  // posted with a non-JSON content type" case steps.md's decision log names
  // for this code (2026-08-17 entry).
  if (!Buffer.isBuffer(rawBody)) {
    throw new AppError({
      statusCode: 400,
      code: 'INVALID_WEBHOOK_PAYLOAD',
      message: 'The webhook payload could not be processed.',
    });
  }

  await webhookService.processPaymentWebhook(rawBody, signature);
  sendSuccess(res, { received: true });
}

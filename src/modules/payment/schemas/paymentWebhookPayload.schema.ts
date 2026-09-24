import { z } from 'zod';

// The minimal shape this handler reads out of Razorpay's actual webhook
// body — every other field (amount, currency, method, created_at, ...) is
// present in a real delivery but irrelevant here and simply stripped, the
// same "unknown keys don't matter" convention used by every request schema
// in this codebase. Validated AFTER signature verification, never before —
// this schema exists to catch a malformed payload, not to gate trust.
export const paymentWebhookPayloadSchema = z.object({
  event: z.string(),
  payload: z.object({
    payment: z.object({
      entity: z.object({
        id: z.string(),
        order_id: z.string(),
      }),
    }),
  }),
});

export type PaymentWebhookPayload = z.infer<typeof paymentWebhookPayloadSchema>;

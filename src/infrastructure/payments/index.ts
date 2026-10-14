import { config } from '../../config';
import { AppError } from '../../shared/AppError';
import type { PaymentProvider } from './PaymentProvider';
import { RazorpayProvider } from './RazorpayProvider';
import { StubPaymentProvider } from './StubPaymentProvider';

export type {
  CreateOrderParams,
  CreateOrderResult,
  PaymentProvider,
  RefundParams,
  RefundResult,
  VerifyPaymentParams,
} from './PaymentProvider';

// Selection is a factory keyed off config, never a concrete class imported
// by a consumer — the same real-vs-fallback pattern as Brevo/Cloudinary.
// Fake order ids and no money moving make the stub actively unsafe in
// production, hence the loud warning whenever it is the one in use.
//
// `providerName` is decided by the exact same condition and exported
// alongside the instance, so paymentRecordService can tag each Payment row
// with which provider actually created it — never hardcoded at a call site,
// so historical rows stay accurate if the active provider changes later.
export const providerName: 'razorpay' | 'stub' =
  config.payments.providerKey && config.payments.providerSecret ? 'razorpay' : 'stub';

// The Razorpay `key_id` only — never `providerSecret`. Razorpay's own
// Checkout.js contract requires this client-side to open the payment
// modal; it is designed to be public (it authenticates nothing by itself,
// unlike the secret), but until now nothing exported it past this factory.
// `null` whenever `providerName` isn't 'razorpay' (Stub has no real key to
// hand out), same condition as providerName itself so the two can never
// disagree.
export const providerKeyId: string | null =
  providerName === 'razorpay' ? (config.payments.providerKey as string) : null;

// Phase 15 (architecture.md's own fallback-safety table: "Payment... No safe
// fallback — boot refuses"): StubPaymentProvider is fine in development,
// but silently degrading to it in production means real bookings with no
// money actually moving. Development/test are unaffected; only
// NODE_ENV=production refuses to boot.
function createPaymentProvider(): PaymentProvider {
  if (providerName === 'razorpay') {
    return new RazorpayProvider();
  }

  if (config.isProduction) {
    throw new AppError({
      statusCode: 500,
      code: 'INVALID_ENVIRONMENT_CONFIGURATION',
      message:
        'PAYMENT_PROVIDER_KEY and PAYMENT_PROVIDER_SECRET are required in production — refusing to fall back to StubPaymentProvider.',
    });
  }

  console.warn(
    '[payments] No real payment provider configured — using StubPaymentProvider ' +
      '(fake order ids, no money moves).',
  );
  return new StubPaymentProvider();
}

export const paymentProvider: PaymentProvider = createPaymentProvider();

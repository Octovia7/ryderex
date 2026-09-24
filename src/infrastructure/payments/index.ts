import { config } from '../../config';
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
function createPaymentProvider(): PaymentProvider {
  if (config.payments.providerKey && config.payments.providerSecret) {
    return new RazorpayProvider();
  }

  console.warn(
    '[payments] No real payment provider configured — using StubPaymentProvider ' +
      '(fake order ids, no money moves).',
  );
  return new StubPaymentProvider();
}

export const paymentProvider: PaymentProvider = createPaymentProvider();

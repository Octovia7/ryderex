import type { PaymentProvider } from './PaymentProvider';
import { StubPaymentProvider } from './StubPaymentProvider';

export type {
  CreateOrderParams,
  CreateOrderResult,
  PaymentProvider,
  RefundParams,
  RefundResult,
  VerifyPaymentParams,
} from './PaymentProvider';

// No real gateway is integrated yet, so the stub is the only implementation.
// Selection is still a factory — never a concrete class imported by a
// consumer — so the real provider slots in here later without touching any
// caller.
function createPaymentProvider(): PaymentProvider {
  console.warn(
    '[payments] No real payment provider configured — using StubPaymentProvider ' +
      '(fake order ids, no money moves).',
  );
  return new StubPaymentProvider();
}

export const paymentProvider: PaymentProvider = createPaymentProvider();

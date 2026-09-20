import { randomUUID } from 'node:crypto';
import type {
  CreateOrderParams,
  CreateOrderResult,
  PaymentProvider,
  RefundParams,
  RefundResult,
  VerifyPaymentParams,
} from './PaymentProvider';

// A local stand-in with no gateway behind it: order ids are generated
// locally and no money ever moves. That makes it unsafe as a production
// provider (real rides against a gateway that charges nobody), which is why
// the factory warns loudly whenever it is the one in use.
export class StubPaymentProvider implements PaymentProvider {
  createOrder(_params: CreateOrderParams): Promise<CreateOrderResult> {
    return Promise.resolve({ orderId: `order_stub_${randomUUID().replace(/-/g, '')}` });
  }

  // Unreachable today — nothing calls it. Throwing (rather than returning a
  // plausible answer) means a future caller that forgets to swap in a real
  // provider fails loudly instead of "verifying" a payment that never happened.
  verifyPayment(_params: VerifyPaymentParams): boolean {
    throw new Error('StubPaymentProvider.verifyPayment is not implemented.');
  }

  refund(_params: RefundParams): Promise<RefundResult> {
    return Promise.reject(new Error('StubPaymentProvider.refund is not implemented.'));
  }
}

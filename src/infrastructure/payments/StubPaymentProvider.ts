import { randomUUID } from 'node:crypto';
import { config } from '../../config';
import type {
  CreateOrderParams,
  CreateOrderResult,
  PaymentProvider,
  RefundParams,
  RefundResult,
  VerifyPaymentParams,
} from './PaymentProvider';
import { verifyHmacSignature } from './webhookSignature';

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

  // Implemented for real, unlike verifyPayment above: refundService now
  // calls this for every PENDING REFUND transaction, so local testing
  // without a Razorpay account still exercises a genuine refund reference
  // id, the same real-vs-fallback split as createOrder.
  refund(_params: RefundParams): Promise<RefundResult> {
    return Promise.resolve({ refundId: `refund_stub_${randomUUID().replace(/-/g, '')}` });
  }

  // Implemented for real, unlike verifyPayment above: local testing without
  // a Razorpay account should still exercise genuine HMAC-SHA256 signature
  // verification, against the same PAYMENT_PROVIDER_WEBHOOK_SECRET a real
  // provider would use. Shared with RazorpayProvider so the two can't drift.
  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    return verifyHmacSignature(config.payments.webhookSecret, rawBody, signature);
  }
}

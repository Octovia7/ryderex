import Razorpay from 'razorpay';
import { config } from '../../config';
import { AppError } from '../../shared/AppError';
import type {
  CreateOrderParams,
  CreateOrderResult,
  PaymentProvider,
  RefundParams,
  RefundResult,
  VerifyPaymentParams,
} from './PaymentProvider';
import { verifyHmacSignature } from './webhookSignature';

// The real gateway. The SDK handles createOrder/refund — a single HTTP call
// each, but the SDK is worth it for auth and error normalisation — while
// signature verification goes through node:crypto directly, shared with
// StubPaymentProvider, since that crypto is vendor-specific and the same
// scheme either way.
export class RazorpayProvider implements PaymentProvider {
  private readonly client: Razorpay;

  constructor() {
    // The factory only ever constructs this when both are configured; this
    // guard is what makes that invariant loud if it's ever violated, rather
    // than constructing a client that fails mysteriously on first use.
    if (!config.payments.providerKey || !config.payments.providerSecret) {
      throw new Error(
        'RazorpayProvider requires PAYMENT_PROVIDER_KEY and PAYMENT_PROVIDER_SECRET.',
      );
    }

    // Razorpay's own constructor just stores the key and fails lazily on the
    // first real call — nothing else to guard here.
    this.client = new Razorpay({
      key_id: config.payments.providerKey,
      key_secret: config.payments.providerSecret,
    });
  }

  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    try {
      // Razorpay's minor unit is paise; the conversion belongs to this
      // provider, never to a caller (the interface's own contract).
      const order = await this.client.orders.create({
        amount: Math.round(params.amount * 100),
        currency: 'INR',
        receipt: params.receipt,
      });

      return { orderId: order.id };
    } catch (cause) {
      throw new AppError({
        statusCode: 502,
        code: 'PAYMENT_PROVIDER_ERROR',
        message: 'Failed to create the payment order.',
        cause,
      });
    }
  }

  // Razorpay's documented checkout-verification scheme: HMAC-SHA256 of
  // "order_id|payment_id" using the account's key secret — a different
  // credential and a different signature from the webhook's own.
  verifyPayment(params: VerifyPaymentParams): boolean {
    const payload = `${params.orderId}|${params.paymentId}`;
    return verifyHmacSignature(config.payments.providerSecret, payload, params.signature);
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    try {
      const refund = await this.client.payments.refund(params.paymentId, {
        amount: Math.round(params.amount * 100),
      });

      return { refundId: refund.id };
    } catch (cause) {
      throw new AppError({
        statusCode: 502,
        code: 'PAYMENT_PROVIDER_ERROR',
        message: 'Failed to process the refund.',
        cause,
      });
    }
  }

  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    return verifyHmacSignature(config.payments.webhookSecret, rawBody, signature);
  }
}

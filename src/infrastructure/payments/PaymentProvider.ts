export interface CreateOrderParams {
  // Whole rupees. Any conversion to a vendor's minor unit (paise) belongs to
  // that vendor's provider, never to the caller.
  amount: number;
  receipt: string;
}

export interface CreateOrderResult {
  orderId: string;
}

export interface VerifyPaymentParams {
  orderId: string;
  paymentId: string;
  signature: string;
}

export interface RefundParams {
  paymentId: string;
  amount: number;
}

export interface RefundResult {
  refundId: string;
}

// `createOrder` is the only one anything calls today (ride/booking creation's
// own orders); `verifyPayment` and `refund` are part of the contract so a
// real vendor slots in behind it unchanged, but nothing consumes them until
// the webhook and refund phases.
//
// `verifyWebhookSignature` is the fourth method, added when the provider
// needed to become real: signature verification is vendor-specific crypto,
// which is exactly the kind of detail this abstraction exists to keep out of
// the domain. `rawBody` must be the exact bytes the signature was computed
// over — never a re-serialized string. Nothing calls it yet either; the
// webhook endpoint that will is a later step.
export interface PaymentProvider {
  createOrder(params: CreateOrderParams): Promise<CreateOrderResult>;
  verifyPayment(params: VerifyPaymentParams): boolean;
  refund(params: RefundParams): Promise<RefundResult>;
  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean;
}

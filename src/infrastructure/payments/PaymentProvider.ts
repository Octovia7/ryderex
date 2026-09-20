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

// The original three methods. `createOrder` is the only one anything calls
// today (ride creation's posting-commission order); `verifyPayment` and
// `refund` are part of the contract so a real vendor slots in behind it
// unchanged, but nothing consumes them until the payments and refunds phases.
export interface PaymentProvider {
  createOrder(params: CreateOrderParams): Promise<CreateOrderResult>;
  verifyPayment(params: VerifyPaymentParams): boolean;
  refund(params: RefundParams): Promise<RefundResult>;
}

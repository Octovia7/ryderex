import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../shared/AppError';

// Shared by RazorpayProvider (webhook + checkout signatures) and
// StubPaymentProvider (webhook signatures only) — one call site, so the two
// can never drift, and so local testing without a Razorpay account still
// exercises genuine HMAC-SHA256 verification rather than a stand-in.
//
// `payload` must be the exact raw bytes the signature was computed over —
// never a re-serialized string — which is the caller's responsibility.
export function verifyHmacSignature(
  secret: string | undefined,
  payload: string | Buffer,
  signature: string,
): boolean {
  if (!secret) {
    throw new AppError({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Signature verification is not configured.',
    });
  }

  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const providedBuffer = Buffer.from(signature, 'hex');

  // timingSafeEqual throws on a length mismatch rather than returning false —
  // a malformed or forged signature is exactly that case, so it is treated as
  // a mismatch here, never allowed to crash the caller.
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

// A deliberately separate client from ./client.ts, the same convention
// ./places.ts already uses: this talks to a third party (Razorpay's own
// Checkout.js) directly from the browser, never our own backend. No npm
// package is involved or needed — Razorpay's documented web integration is
// exactly this script tag, exposing a global `Razorpay` constructor.
const CHECKOUT_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

export interface RazorpayCheckoutOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name?: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
  handler?: (response: unknown) => void;
}

export interface RazorpayCheckoutInstance {
  open(): void;
  on(event: 'payment.failed', handler: (response: unknown) => void): void;
  // Part of the real SDK's documented API — used to tear down an open modal
  // on unmount, since it lives in a DOM node Checkout.js attaches directly
  // to document.body, outside anything React's own tree controls.
  close(): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayCheckoutInstance;
  }
}

export class CheckoutUnavailableError extends Error {
  constructor() {
    super('Could not load the payment checkout. Check your connection and try again.');
    this.name = 'CheckoutUnavailableError';
  }
}

// Caches the in-flight/settled load so concurrent or repeated calls never
// inject the script twice. Rejects rather than throwing synchronously, so a
// script-load failure (offline, ad blocker, CDN outage) surfaces as a
// catchable error a caller can show honestly instead of crashing the app.
let loadPromise: Promise<void> | null = null;

export function loadRazorpayCheckout(): Promise<void> {
  if (typeof window !== 'undefined' && window.Razorpay) {
    return Promise.resolve();
  }
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Let a later retry attempt the injection again rather than caching a
      // permanent failure from what may have been a transient outage.
      loadPromise = null;
      reject(new CheckoutUnavailableError());
    };
    document.body.appendChild(script);
  });

  return loadPromise;
}

// Both booking and ride checkout-details responses share this exact shape
// (CheckoutDetails in bookings.ts, RideCheckoutDetails in rides.ts) — a
// structural type here lets one check serve both without either file
// importing from the other. Checked right before constructing Razorpay
// options: a non-empty keyId/orderId/currency and a positive integer
// amount (Razorpay's own minor unit). Never transforms or recalculates the
// amount — only validates the value the backend already returned.
export function isValidCheckoutDetails(details: {
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
}): boolean {
  return (
    typeof details.keyId === 'string' &&
    details.keyId.length > 0 &&
    typeof details.orderId === 'string' &&
    details.orderId.length > 0 &&
    typeof details.currency === 'string' &&
    details.currency.length > 0 &&
    Number.isInteger(details.amount) &&
    details.amount > 0
  );
}

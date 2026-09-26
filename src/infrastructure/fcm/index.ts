import { config } from '../../config';
import { ConsolePushProvider } from './ConsolePushProvider';
import { FirebasePushProvider } from './FirebasePushProvider';
import type { PushProvider } from './PushProvider';

export type { PushPayload, PushProvider, PushSendResult } from './PushProvider';

// Selection is a factory keyed off config, never a concrete class imported
// by a consumer — the same real-vs-fallback pattern as Brevo/Razorpay.
//
// Unlike Payment/Email, a misconfigured push credential must degrade
// delivery, never take down the whole process (architecture.md §16's
// fallback-safety table: "Push / AI ... Yes, degraded — warns loudly") —
// nothing about auth, rides, or payments depends on push actually working.
// `FirebasePushProvider`'s construction is wrapped in try/catch for exactly
// this reason: firebase-admin's `cert()` throws synchronously on a
// malformed private key, and that must fall back, not crash the process.
function createPushProvider(): PushProvider {
  if (config.fcm.projectId && config.fcm.clientEmail && config.fcm.privateKey) {
    try {
      return new FirebasePushProvider();
    } catch (error) {
      console.error(
        '[push] FCM_* configured but FirebasePushProvider failed to construct — ' +
          'falling back to ConsolePushProvider.',
        error,
      );
      return new ConsolePushProvider();
    }
  }

  console.warn('[push] FCM_* not configured — falling back to ConsolePushProvider.');
  return new ConsolePushProvider();
}

export const pushProvider: PushProvider = createPushProvider();

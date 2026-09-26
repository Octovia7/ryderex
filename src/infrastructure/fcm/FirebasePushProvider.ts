import type { App } from 'firebase-admin/app';
import { cert, initializeApp } from 'firebase-admin/app';
import { getMessaging, type MulticastMessage } from 'firebase-admin/messaging';
import { config } from '../../config';
import type { PushPayload, PushProvider, PushSendResult } from './PushProvider';

// FCM's own codes for a genuinely dead token — deliberately excludes
// `messaging/invalid-argument` (architecture.md §15): FCM returns that code
// for both a malformed token AND a malformed payload, so treating it as a
// dead token would wipe every user's devices on a payload bug, and retrying
// would never succeed either.
const INVALID_TOKEN_ERROR_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

// The real gateway. Uses the SDK for service-account JWT exchange
// (architecture.md §16: "Firebase uses the SDK for service-account JWT
// exchange"), `sendEachForMulticast` — deliberately the tokens-based API
// over the newer FID-based one, since our domain model is registration
// tokens (`user_devices.device_token`), not FIDs.
export class FirebasePushProvider implements PushProvider {
  private readonly app: App;

  constructor() {
    // The factory only ever constructs this when all three are configured;
    // this guard is what makes that invariant loud if it's ever violated,
    // rather than constructing a client that fails mysteriously on first use.
    if (!config.fcm.projectId || !config.fcm.clientEmail || !config.fcm.privateKey) {
      throw new Error(
        'FirebasePushProvider requires FCM_PROJECT_ID, FCM_CLIENT_EMAIL, and FCM_PRIVATE_KEY.',
      );
    }

    // A malformed service account address is a routine misconfiguration,
    // not grounds to let firebase-admin's own (much less actionable) error
    // surface instead.
    if (!config.fcm.clientEmail.endsWith('.iam.gserviceaccount.com')) {
      throw new Error(
        'FCM_CLIENT_EMAIL must be a service account address (*.iam.gserviceaccount.com).',
      );
    }

    // firebase-admin's cert() parses the private key SYNCHRONOUSLY and
    // throws on anything that isn't valid PEM — once took down the entire
    // process at import time over a misconfigured push credential
    // (architecture.md §16). This constructor throwing (rather than that
    // happening at module scope) is what lets the factory catch it and fall
    // back to ConsolePushProvider instead of crashing.
    this.app = initializeApp({
      credential: cert({
        projectId: config.fcm.projectId,
        clientEmail: config.fcm.clientEmail,
        // Env vars cannot hold a literal newline; the SDK expects real ones.
        privateKey: config.fcm.privateKey.replace(/\\n/g, '\n'),
      }),
    });
  }

  async send(tokens: string[], payload: PushPayload): Promise<PushSendResult[]> {
    if (tokens.length === 0) {
      return [];
    }

    const message: MulticastMessage = {
      tokens,
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
    };

    const response = await getMessaging(this.app).sendEachForMulticast(message);

    return response.responses.map((result, index) => {
      const token = tokens[index];

      if (result.success) {
        return { token, success: true, invalidToken: false, retriable: false };
      }

      const errorCode = result.error?.code;
      const invalidToken = errorCode !== undefined && INVALID_TOKEN_ERROR_CODES.has(errorCode);

      return {
        token,
        success: false,
        invalidToken,
        // Anything that isn't a known-dead token is worth retrying, except
        // the deliberately-excluded messaging/invalid-argument above — never
        // a dead token, never worth retrying either.
        retriable: !invalidToken && errorCode !== 'messaging/invalid-argument',
        errorCode,
      };
    });
  }
}

import type { PushPayload, PushProvider, PushSendResult } from './PushProvider';

// The local-dev fallback: logs instead of sending, and always reports
// success — there is no gateway to fail against, so pretending otherwise
// would only teach a caller to handle a failure mode that can never happen
// here. Selected the same way Brevo/Razorpay's own fallbacks are, but with
// a different safety verdict (architecture.md §16's fallback-safety table):
// push degrades gracefully in production rather than refusing to boot,
// since nothing about auth, rides, or payments depends on it working.
//
// Tokens are logged as an 8-character prefix plus length only
// (architecture.md §15) — the same discipline a real token deserves, even a
// fake one, since a token can be used to push to that specific device.
export class ConsolePushProvider implements PushProvider {
  send(tokens: string[], payload: PushPayload): Promise<PushSendResult[]> {
    for (const token of tokens) {
      console.log(
        `[push:console] -> ${token.slice(0, 8)}... (len ${token.length}): ` +
          `"${payload.title}" — ${payload.body}`,
      );
    }

    return Promise.resolve(
      tokens.map((token) => ({ token, success: true, invalidToken: false, retriable: false })),
    );
  }
}

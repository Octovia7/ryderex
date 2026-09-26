// The strategy interface behind push delivery (architecture.md §16, a
// spec §17/§37-style abstraction): one method, `send`. What a vendor swap
// needs to change is only how tokens+payload become an actual delivery
// attempt — never what a caller supplies.
export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

// Failure classification lives HERE, not in the caller (architecture.md
// §15's "Failure classification lives in the provider"): a real incident
// showed firebase-admin reporting even `app/invalid-credential` — a fully
// broken service account — as a per-token result rather than throwing,
// which made push delivery silently 0% functional with nothing saying so.
//
// `success`/`invalidToken`/`retriable` are deliberately independent flags,
// not one enum: FCM's `messaging/invalid-argument` is neither — it returns
// that code for both a malformed token and a malformed payload, so treating
// it as a dead token would wipe every user's devices on a payload bug, and
// retrying would never succeed either.
export interface PushSendResult {
  token: string;
  success: boolean;
  invalidToken: boolean;
  retriable: boolean;
  errorCode?: string;
}

// `send` resolves per-token outcomes rather than throwing per token — real
// FCM behavior, where a stale token is routine, not exceptional. It only
// throws for a genuine gateway-level failure (a malformed credential, a
// network failure), which is what lets a caller's retry logic (BullMQ's
// bounded backoff) distinguish "some tokens are dead" from "the whole call
// failed."
export interface PushProvider {
  send(tokens: string[], payload: PushPayload): Promise<PushSendResult[]>;
}

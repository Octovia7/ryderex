import { API_BASE_URL } from './config';

// Mirrors the backend's one error envelope exactly (src/middleware/
// errorHandler.ts): { success:false, error:{ code, message }, requestId }.
// `code` lets callers branch on specific cases (e.g. the "new account needs
// name/phone" case below); `message` is always safe to show as-is.
export class ApiError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly requestId?: string;

  constructor(args: { code: string; message: string; statusCode: number; requestId?: string }) {
    super(args.message);
    this.name = 'ApiError';
    this.code = args.code;
    this.statusCode = args.statusCode;
    this.requestId = args.requestId;
  }
}

interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  accessToken?: string | null;
  // Required by the backend on payment-order-creating routes only (src/
  // middleware/idempotency.ts) — optional here so every other call site is
  // unaffected. The caller owns key lifetime/reuse; this layer just sends it.
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (cause) {
    // A network failure (offline, CORS rejection, DNS, backend unreachable)
    // never reaches the backend's own error envelope at all — surfaced as
    // its own code so the UI can tell "we couldn't even reach the server"
    // apart from a real API error.
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server. Check your connection and try again.',
      statusCode: 0,
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError({
      code: 'INVALID_RESPONSE',
      message: 'The server returned an unexpected response.',
      statusCode: response.status,
    });
  }

  const body = payload as
    | { success: true; data: T }
    | { success: false; error: { code: string; message: string }; requestId?: string };

  if (!body.success) {
    throw new ApiError({
      code: body.error.code,
      message: body.error.message,
      statusCode: response.status,
      requestId: body.requestId,
    });
  }

  return body.data;
}

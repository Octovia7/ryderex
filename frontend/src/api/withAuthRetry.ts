import { ApiError } from './client';
import type { useSession } from '../auth/session';

type Session = ReturnType<typeof useSession>;

// Wraps one authenticated call: on a 401 (expired access token — 15 min,
// src/config/env.ts), refreshes exactly once through the centralized
// session (never a second, parallel refresh mechanism) and retries with
// the new token. Any other failure, or a failed refresh, propagates as-is.
export async function withAuthRetry<T>(
  session: Session,
  call: (accessToken: string | null) => Promise<T>,
): Promise<T> {
  try {
    return await call(session.accessToken);
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 401) {
      const refreshed = await session.refreshAccessToken();
      if (refreshed) {
        return call(refreshed);
      }
    }
    throw error;
  }
}

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import * as authApi from '../api/auth';
import type { User } from '../api/auth';
import { ApiError } from '../api/client';
import { isValidRole, InvalidSessionError } from './roles';

const REFRESH_TOKEN_KEY = 'saathiride-refresh-token';

function readStoredRefreshToken(): string | null {
  try {
    return window.localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeStoredRefreshToken(token: string | null): void {
  try {
    if (token) {
      window.localStorage.setItem(REFRESH_TOKEN_KEY, token);
    } else {
      window.localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
  } catch {
    // Storage unavailable (private browsing, blocked, etc.) — the session
    // still works for this tab, it just won't survive a reload.
  }
}

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface SessionContextValue {
  status: SessionStatus;
  user: User | null;
  accessToken: string | null;
  requestOtp: (email: string) => Promise<void>;
  verifyOtp: (input: {
    email: string;
    otp: string;
    name?: string;
    phone?: string;
  }) => Promise<User>;
  logout: () => Promise<void>;
  // Exposes the same single-flight refresh every other session operation
  // uses — callers (the API layer's 401 retry) must go through this rather
  // than calling POST /auth/refresh themselves, or two concurrent 401s
  // would race two rotations against one single-use refresh token.
  refreshAccessToken: () => Promise<string | null>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // The refresh token itself never needs to trigger a render on its own —
  // only accessToken/user/status do — so it lives in a ref, not state.
  const refreshTokenRef = useRef<string | null>(null);
  // Single-flight guard: concurrent callers (e.g. two requests both getting
  // a 401 at once, or the mount-time hydration racing a manual action)
  // share one in-flight refresh instead of firing multiple rotations
  // against the same one-use refresh token, where only the first would
  // ever succeed.
  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);

  // Never trusts the role string blindly, even though it comes from our
  // own backend — an unrecognized role must never produce a half-applied
  // session that later code (route guards, dashboard links) can't route.
  function applySession(result: { user: User; accessToken: string; refreshToken: string }) {
    if (!isValidRole(result.user.role)) {
      clearSession();
      throw new InvalidSessionError();
    }
    setUser(result.user);
    setAccessToken(result.accessToken);
    refreshTokenRef.current = result.refreshToken;
    writeStoredRefreshToken(result.refreshToken);
    setStatus('authenticated');
  }

  function clearSession() {
    setUser(null);
    setAccessToken(null);
    refreshTokenRef.current = null;
    writeStoredRefreshToken(null);
    setStatus('unauthenticated');
  }

  function refresh(): Promise<string | null> {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    const token = refreshTokenRef.current;
    if (!token) {
      clearSession();
      return Promise.resolve(null);
    }

    const attempt = authApi
      .refreshSession(token)
      .then((result) => {
        applySession(result);
        return result.accessToken;
      })
      .catch(() => {
        // A failed refresh (expired, reused, revoked) always clears the
        // session — never left half-authenticated.
        clearSession();
        return null;
      })
      .finally(() => {
        refreshPromiseRef.current = null;
      });

    refreshPromiseRef.current = attempt;
    return attempt;
  }

  useEffect(() => {
    const stored = readStoredRefreshToken();
    if (!stored) {
      setStatus('unauthenticated');
      return;
    }
    refreshTokenRef.current = stored;
    void refresh();
    // Intentionally run once, on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      accessToken,
      requestOtp: async (email) => {
        await authApi.requestOtp(email);
      },
      verifyOtp: async (input) => {
        const result = await authApi.verifyOtp(input);
        applySession(result);
        return result.user;
      },
      logout: async () => {
        const token = refreshTokenRef.current;
        clearSession();
        if (token) {
          try {
            await authApi.logout(token);
          } catch (error) {
            // The session is already cleared client-side regardless; a
            // failed server-side revoke (e.g. already expired) shouldn't
            // block the user from being logged out locally.
            if (!(error instanceof ApiError)) {
              throw error;
            }
          }
        }
      },
      refreshAccessToken: refresh,
    }),
    [status, user, accessToken],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return ctx;
}

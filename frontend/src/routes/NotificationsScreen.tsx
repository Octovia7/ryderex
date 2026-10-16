import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import { withAuthRetry } from '../api/withAuthRetry';
import { listNotifications, markNotificationRead } from '../api/notifications';
import type { Notification } from '../api/notifications';
import { ApiError } from '../api/client';

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function NotificationsScreen() {
  const session = useSession();
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // Carries the cursor the FAILED attempt used, alongside the message —
  // `cursor: undefined` means the failure was the initial (page 1) load; a
  // defined cursor means it was a "load more" page. Retry reads this back
  // so a load-more failure retries that exact page rather than always
  // restarting from page 1 — the same fix already applied to
  // DriverRidesScreen's passenger-list pagination.
  const [error, setError] = useState<{ message: string; cursor?: string } | null>(null);
  // Synchronous guard against a rapid double-click firing two overlapping
  // requests before React re-renders with the button disabled — same
  // reasoning as every other list in this app. GET /notifications carries
  // no Idempotency-Key, so there's no backend-side backstop against a
  // raced duplicate here either.
  const loadInFlightRef = useRef(false);

  // Which notification is currently being marked read (drives its own
  // disabled/loading state); per-notification errors, keyed by id, so one
  // row's error never clobbers another's.
  const [markingReadId, setMarkingReadId] = useState<string | null>(null);
  const [markReadErrors, setMarkReadErrors] = useState<Record<string, string>>({});
  // Synchronous guard, same reasoning as loadInFlightRef: a rapid
  // double-tap on the same notification could otherwise fire two
  // overlapping PATCH requests before React re-renders with it disabled.
  const markReadInFlightRef = useRef<Set<string>>(new Set());

  // Loads (or, when `cursor` is given, appends) one page. Used for the
  // initial mount load, "load more", and retrying either kind of failure
  // with the exact cursor that failed.
  async function loadNotifications(cursor?: string) {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setError(null);

    try {
      const page = await withAuthRetry(session, (token) =>
        listNotifications(cursor ? { cursor } : {}, token),
      );
      setNotifications((current) => (cursor ? [...current, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.';
      setError({ message, cursor });
    } finally {
      loadInFlightRef.current = false;
      if (cursor) setLoadingMore(false);
      else setLoading(false);
    }
  }

  useEffect(() => {
    void loadNotifications();
    // Mount-once: session's identity is stable per its own context memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marks one notification read when the user activates it. A no-op for
  // an already-read one — nothing to send. Updates local state from the
  // ACTUAL returned Notification, never optimistically: the backend's own
  // markRead is the only thing that may ever change readAt.
  async function handleActivate(notification: Notification) {
    if (notification.readAt !== null) return;
    if (markReadInFlightRef.current.has(notification.id)) return;
    markReadInFlightRef.current.add(notification.id);
    setMarkingReadId(notification.id);
    setMarkReadErrors((current) => {
      if (!(notification.id in current)) return current;
      const next = { ...current };
      delete next[notification.id];
      return next;
    });

    try {
      const updated = await withAuthRetry(session, (token) =>
        markNotificationRead(notification.id, token),
      );
      setNotifications((current) => current.map((n) => (n.id === notification.id ? updated : n)));
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.';
      setMarkReadErrors((current) => ({ ...current, [notification.id]: message }));
    } finally {
      markReadInFlightRef.current.delete(notification.id);
      setMarkingReadId((current) => (current === notification.id ? null : current));
    }
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-ui)', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          padding: '20px 16px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--surface-1)',
        }}
      >
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate(-1)}
          style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>Notifications</h1>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 48px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '48px 0' }}>Loading notifications…</p>
        )}

        {!loading && error && notifications.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--warning-border)' }}>
            <p role="alert" style={{ margin: 0, color: 'var(--warning)', fontSize: 14 }}>
              {error.message}
            </p>
            <button
              type="button"
              onClick={() => void loadNotifications(error.cursor)}
              style={{ height: 40, borderRadius: 'var(--radius-control)', border: '1px solid var(--border)', background: 'var(--surface-3)', color: 'var(--accent-2)', font: '600 13px var(--font-ui)', cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && notifications.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '48px 16px' }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>No notifications yet</p>
            <p style={{ margin: '6px 0 0', fontSize: 13 }}>Updates about your rides and bookings will show up here.</p>
          </div>
        )}

        {!loading && notifications.length > 0 && (
          <>
            {notifications.map((notification) => {
              const unread = notification.readAt === null;
              const marking = markingReadId === notification.id;
              const markError = markReadErrors[notification.id];

              return (
                <div key={notification.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => void handleActivate(notification)}
                    disabled={marking}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      padding: 16,
                      borderRadius: 18,
                      textAlign: 'left',
                      cursor: unread ? 'pointer' : 'default',
                      background: unread ? 'rgba(11,129,147,.06)' : 'var(--surface-1)',
                      border: `1px solid ${unread ? 'var(--accent)' : 'var(--border-subtle)'}`,
                      color: 'var(--text)',
                      width: '100%',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      {unread && (
                        <span
                          aria-hidden="true"
                          style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)', marginTop: 5, flexShrink: 0 }}
                        />
                      )}
                      <span style={{ flex: 1, fontSize: 14, fontWeight: unread ? 700 : 500 }}>
                        {notification.title}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {formatDateTime(notification.createdAt)}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.4, color: 'var(--text-2)', paddingLeft: unread ? 16 : 0 }}>
                      {notification.body}
                    </p>
                  </button>
                  {markError && (
                    <p role="alert" style={{ margin: 0, fontSize: 11, color: 'var(--warning)' }}>
                      {markError}
                    </p>
                  )}
                </div>
              );
            })}

            {error ? (
              // A LATER page failed — the list above is the same one
              // already shown before the failure, untouched; this
              // replaces only the "load more" slot with an error + retry
              // that reuses the exact cursor that failed.
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--warning)' }}>
                  {error.message}
                </p>
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void loadNotifications(error.cursor)}
                  style={{
                    height: 44,
                    borderRadius: 'var(--radius-control)',
                    border: '1px solid var(--border)',
                    background: 'var(--surface-2)',
                    color: 'var(--text)',
                    font: '600 13px var(--font-ui)',
                    cursor: loadingMore ? 'default' : 'pointer',
                  }}
                >
                  {loadingMore ? 'Loading…' : 'Retry'}
                </button>
              </div>
            ) : (
              nextCursor && (
                <button
                  type="button"
                  onClick={() => void loadNotifications(nextCursor)}
                  disabled={loadingMore}
                  style={{ height: 52, borderRadius: 16, background: 'transparent', border: '1px dashed var(--border)', color: 'var(--text-2)', font: '500 14px var(--font-ui)', cursor: loadingMore ? 'default' : 'pointer' }}
                >
                  {loadingMore ? 'Loading…' : 'Load more notifications'}
                </button>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}

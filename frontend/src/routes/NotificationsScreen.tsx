import { ChevronLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import { withAuthRetry } from '../api/withAuthRetry';
import { listNotifications, markNotificationRead } from '../api/notifications';
import type { Notification } from '../api/notifications';
import { ApiError } from '../api/client';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { cn } from '../lib/cn';

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
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate(-1)}
          className="flex size-10 items-center justify-center rounded-lg border border-border-strong bg-surface text-ink-muted transition-colors hover:bg-slate-50"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Notifications</h1>
      </div>

      <div className="flex flex-col gap-2.5">
        {loading && <p className="py-12 text-center text-sm text-ink-muted">Loading notifications…</p>}

        {!loading && error && notifications.length === 0 && (
          <Card className="border-red-200 bg-red-50 p-4">
            <p role="alert" className="text-sm text-red-700">
              {error.message}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3 w-fit"
              onClick={() => void loadNotifications(error.cursor)}
            >
              Try again
            </Button>
          </Card>
        )}

        {!loading && !error && notifications.length === 0 && (
          <div className="py-12 text-center text-ink-muted">
            <p className="text-sm font-semibold text-ink">No notifications yet</p>
            <p className="mt-1.5 text-xs">Updates about your rides and bookings will show up here.</p>
          </div>
        )}

        {!loading && notifications.length > 0 && (
          <>
            {notifications.map((notification) => {
              const unread = notification.readAt === null;
              const marking = markingReadId === notification.id;
              const markError = markReadErrors[notification.id];

              return (
                <div key={notification.id} className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleActivate(notification)}
                    disabled={marking}
                    className={cn(
                      'flex w-full flex-col gap-1.5 rounded-lg border p-4 text-left text-ink',
                      unread ? 'cursor-pointer border-accent-600 bg-accent-50' : 'cursor-default border-border-subtle bg-surface',
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {unread && (
                        <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-accent-600" />
                      )}
                      <span className={cn('flex-1 text-sm', unread ? 'font-bold' : 'font-medium')}>
                        {notification.title}
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-xs text-ink-faint">
                        {formatDateTime(notification.createdAt)}
                      </span>
                    </div>
                    <p className={cn('text-xs leading-relaxed text-ink-muted', unread && 'pl-4')}>
                      {notification.body}
                    </p>
                  </button>
                  {markError && (
                    <p role="alert" className="text-[11px] text-red-600">
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
              <div className="flex flex-col gap-2">
                <p role="alert" className="text-xs text-red-600">
                  {error.message}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={loadingMore}
                  onClick={() => void loadNotifications(error.cursor)}
                >
                  Retry
                </Button>
              </div>
            ) : (
              nextCursor && (
                <Button
                  variant="ghost"
                  loading={loadingMore}
                  className="border border-dashed border-border-strong"
                  onClick={() => void loadNotifications(nextCursor)}
                >
                  Load more notifications
                </Button>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}

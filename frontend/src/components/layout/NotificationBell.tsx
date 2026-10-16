import { Bell } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { listNotifications } from '@/api/notifications';
import { withAuthRetry } from '@/api/withAuthRetry';
import { useSession } from '@/auth/session';

// There is no unread-count endpoint, so the badge is derived from the first
// page of the list — bounded at one page, hence the "9+" cap rather than an
// exact number the API cannot promise.
const MAX_BADGE = 9;

export function NotificationBell() {
  const session = useSession();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const page = await withAuthRetry(session, (token) => listNotifications({}, token));
        if (cancelled) return;
        setUnread(page.items.filter((item) => item.readAt === null).length);
      } catch {
        // A failed badge fetch is not worth surfacing — the full list on
        // /notifications is still reachable and will show the real state.
      }
    }

    void load();
    // Returning to the tab is the natural moment to recheck — notifications
    // have no push channel to the browser.
    function onFocus() {
      void load();
    }
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
    // Mount-once plus focus re-check: session's identity is stable per its
    // own context memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Link
      to="/notifications"
      aria-label={unread > 0 ? `Notifications, ${String(unread)} unread` : 'Notifications'}
      className="relative rounded-md p-2 text-ink-muted transition-colors hover:bg-slate-100 hover:text-ink"
    >
      <Bell className="size-5" />
      {unread > 0 && (
        <span
          aria-hidden
          className="absolute right-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-accent-700 px-1 text-[10px] font-medium leading-4 text-white"
        >
          {unread > MAX_BADGE ? `${String(MAX_BADGE)}+` : unread}
        </span>
      )}
    </Link>
  );
}

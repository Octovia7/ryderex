import { ChevronDown, LogOut, Menu, Shield, User, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { useSession } from '@/auth/session';
import { buttonStyles } from '@/components/ui/Button';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { cn } from '@/lib/cn';

interface NavItem {
  to: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/search', label: 'Find a ride' },
  { to: '/trips', label: 'My trips' },
  { to: '/messages', label: 'Messages' },
];

function navLinkClasses({ isActive }: { isActive: boolean }): string {
  return cn(
    'rounded-md px-3 py-2 text-sm font-medium transition-colors',
    isActive ? 'text-accent-700' : 'text-ink-muted hover:text-ink',
  );
}

// Closes a popover on outside click and Escape.
function useDismissable(onDismiss: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onDismiss();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onDismiss();
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onDismiss]);

  return ref;
}

function AccountMenu() {
  const { user, logout } = useSession();
  const isAdmin = user?.role === 'ADMIN';
  const [open, setOpen] = useState(false);
  const ref = useDismissable(() => {
    setOpen(false);
  });

  const initial = user?.name.trim().charAt(0).toUpperCase() ?? '?';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
        }}
        className="flex items-center gap-1.5 rounded-md p-1 transition-colors hover:bg-slate-100"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-accent-700 text-sm font-medium text-white">
          {initial}
        </span>
        <ChevronDown className="size-4 text-ink-faint" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-56 overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-lg"
        >
          <div className="border-b border-border-subtle px-3 py-2.5">
            <p className="truncate text-sm font-medium text-ink">{user?.name}</p>
            <p className="truncate text-xs text-ink-muted">{user?.email}</p>
          </div>

          <Link
            to="/account"
            role="menuitem"
            onClick={() => {
              setOpen(false);
            }}
            className="flex items-center gap-2 px-3 py-2 text-sm text-ink transition-colors hover:bg-slate-50"
          >
            <User className="size-4 text-ink-faint" aria-hidden />
            Account
          </Link>

          {isAdmin && (
            <Link
              to="/admin"
              role="menuitem"
              onClick={() => {
                setOpen(false);
              }}
              className="flex items-center gap-2 px-3 py-2 text-sm text-ink transition-colors hover:bg-slate-50"
            >
              <Shield className="size-4 text-ink-faint" aria-hidden />
              Admin
            </Link>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
            className="flex w-full items-center gap-2 border-t border-border-subtle px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-slate-50"
          >
            <LogOut className="size-4 text-ink-faint" aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// Shared header for every authenticated screen (replaces the per-screen
// "Signed in as X" row and ad hoc back buttons). Public screens (landing,
// login) render their own header instead — this only wraps routes behind
// ProtectedRoute.
export function AppShell() {
  const { status, user } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const signedIn = status === 'authenticated';
  const isDriver = user?.role === 'DRIVER';

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="sticky top-0 z-40 border-b border-border-subtle bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:px-6">
          <Link to="/" className="mr-2 text-lg font-semibold tracking-tight text-accent-700">
            Rydex
          </Link>

          {signedIn && (
            <nav className="hidden items-center md:flex">
              {NAV_ITEMS.map((item) => (
                <NavLink key={item.to} to={item.to} className={navLinkClasses}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          )}

          <div className="ml-auto flex items-center gap-2">
            {signedIn ? (
              <>
                {isDriver && (
                  <Link
                    to="/driver/offer"
                    className={cn(buttonStyles({ variant: 'secondary', size: 'sm' }), 'hidden sm:inline-flex')}
                  >
                    Offer a ride
                  </Link>
                )}
                <NotificationBell />
                <AccountMenu />
                <button
                  type="button"
                  aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
                  aria-expanded={mobileOpen}
                  onClick={() => {
                    setMobileOpen((current) => !current);
                  }}
                  className="rounded-md p-2 text-ink-muted transition-colors hover:bg-slate-100 md:hidden"
                >
                  {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
                </button>
              </>
            ) : (
              <Link to="/login" className={buttonStyles({ size: 'sm' })}>
                Sign in
              </Link>
            )}
          </div>
        </div>

        {signedIn && mobileOpen && (
          <nav className="border-t border-border-subtle bg-surface px-4 py-2 md:hidden">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'block rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                    isActive ? 'text-accent-700' : 'text-ink-muted',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
            {isDriver && (
              <NavLink
                to="/driver/offer"
                className="block rounded-md px-3 py-2.5 text-sm font-medium text-ink-muted sm:hidden"
              >
                Offer a ride
              </NavLink>
            )}
          </nav>
        )}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  );
}

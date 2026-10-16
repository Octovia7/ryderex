import { Bell, Car, LogOut, MapPinned, Search, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import { ModeSwitcher } from '../components/ModeSwitcher';
import { BottomNav } from '../components/BottomNav';

// Landing page for both PASSENGER and DRIVER (see roleHomePath) — a driver
// is never forced into a driver-only dashboard, so "Offer a ride" appears
// alongside "Find a ride" here instead of replacing it.
export function HomeScreen() {
  const { user, logout } = useSession();
  const navigate = useNavigate();
  const isDriver = user?.role === 'DRIVER';

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
        // Bottom padding leaves clearance for the fixed BottomNav below,
        // same 100px convention SearchScreen/TripsScreen already use.
        padding: '48px 16px 100px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 440, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
          {user ? `Signed in as ${user.name} (${user.role})` : ''}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            aria-label="Notifications"
            onClick={() => navigate('/notifications')}
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <Bell size={18} aria-hidden />
          </button>
        </div>
      </div>

      {isDriver && (
        <div style={{ width: '100%', maxWidth: 440 }}>
          <ModeSwitcher active="passenger" />
        </div>
      )}

      <div
        style={{
          width: '100%',
          maxWidth: 440,
          borderRadius: 'var(--radius-card)',
          background: 'var(--surface-1)', boxShadow: 'var(--card-shadow)',
          border: '1px solid var(--border-subtle)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              flexShrink: 0,
              background: 'rgba(11,129,147,.1)',
              color: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MapPinned size={20} aria-hidden />
          </span>
          <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.1, letterSpacing: '-0.03em', fontWeight: 600 }}>
            Where to?
          </h1>
        </div>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-muted)' }}>
          {isDriver
            ? 'Find a seat on someone else’s ride, or offer one of your own.'
            : 'Search for a ride and book a seat.'}
        </p>
      </div>

      <div style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button
          type="button"
          onClick={() => navigate('/search')}
          style={{
            height: 58,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            borderRadius: 'var(--radius-control)',
            border: 0,
            background: 'var(--accent)',
            color: 'var(--accent-on)',
            font: '700 17px var(--font-ui)',
            boxShadow: 'var(--accent-glow)',
            cursor: 'pointer',
          }}
        >
          <Search size={19} aria-hidden />
          Find a ride
        </button>

        {isDriver && (
          <button
            type="button"
            onClick={() => navigate('/driver')}
            style={{
              height: 58,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              borderRadius: 'var(--radius-control)',
              border: '1px solid rgba(107,87,214,.25)',
              background: 'rgba(107,87,214,.08)',
              color: 'var(--accent-2)',
              font: '600 15px var(--font-ui)',
              cursor: 'pointer',
            }}
          >
            <Car size={19} aria-hidden />
            Offer a ride
          </button>
        )}
      </div>

      {user && (
        <div style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            type="button"
            onClick={() => navigate('/account')}
            style={{
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              borderRadius: 'var(--radius-control)',
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--accent-2)',
              font: '600 13px var(--font-ui)',
              cursor: 'pointer',
            }}
          >
            <UserRound size={16} aria-hidden />
            My account
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            style={{
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              borderRadius: 'var(--radius-control)',
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              font: '600 13px var(--font-ui)',
              cursor: 'pointer',
            }}
          >
            <LogOut size={16} aria-hidden />
            Log out
          </button>
        </div>
      )}
      <BottomNav />
    </div>
  );
}

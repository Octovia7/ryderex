import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import { ModeSwitcher } from '../components/ModeSwitcher';

// Driver-only hub (RequireRole restricts this to DRIVER) — links into
// OfferRideScreen and DriverRidesScreen below. ModeSwitcher always leaves a
// way back to the passenger side.
export function DriverHomeScreen() {
  const { user, logout } = useSession();
  const navigate = useNavigate();

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
        padding: '48px 16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 440, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
          {user ? `Signed in as ${user.name} (${user.role})` : ''}
        </span>
      </div>

      <div style={{ width: '100%', maxWidth: 440 }}>
        <ModeSwitcher active="driver" />
      </div>

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
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            letterSpacing: '.14em',
            textTransform: 'uppercase',
            color: 'var(--accent)',
          }}
        >
          Driver
        </span>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.1, letterSpacing: '-0.03em', fontWeight: 600 }}>
          Offer a ride
        </h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-muted)' }}>
          Post a trip you're already taking and let passengers book seats on it, then start,
          complete, or cancel it from My rides. Switch to passenger mode above to search and book
          instead.
        </p>
      </div>

      <div style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button
          type="button"
          onClick={() => navigate('/driver/offer')}
          style={{
            height: 58,
            borderRadius: 'var(--radius-control)',
            border: 0,
            background: 'var(--accent)',
            color: 'var(--accent-on)',
            font: '700 17px var(--font-ui)',
            boxShadow: 'var(--accent-glow)',
            cursor: 'pointer',
          }}
        >
          Offer a ride
        </button>

        <button
          type="button"
          onClick={() => navigate('/driver/rides')}
          style={{
            height: 48,
            borderRadius: 'var(--radius-control)',
            border: '1px solid var(--border)',
            background: 'var(--surface-2)',
            color: 'var(--accent-2)',
            font: '600 14px var(--font-ui)',
            cursor: 'pointer',
          }}
        >
          My rides
        </button>

        <button
          type="button"
          onClick={() => navigate('/driver/vehicle')}
          style={{
            height: 48,
            borderRadius: 'var(--radius-control)',
            border: '1px solid var(--border)',
            background: 'var(--surface-2)',
            color: 'var(--accent-2)',
            font: '600 14px var(--font-ui)',
            cursor: 'pointer',
          }}
        >
          My vehicle
        </button>

        <button
          type="button"
          onClick={() => navigate('/app')}
          style={{
            height: 48,
            borderRadius: 'var(--radius-control)',
            border: '1px solid var(--border)',
            background: 'var(--surface-2)',
            color: 'var(--accent-2)',
            font: '600 14px var(--font-ui)',
            cursor: 'pointer',
          }}
        >
          Find a ride instead
        </button>
      </div>

      {user && (
        <button
          type="button"
          onClick={() => void logout()}
          style={{
            width: '100%',
            maxWidth: 440,
            height: 44,
            borderRadius: 'var(--radius-control)',
            border: '1px solid var(--border)',
            background: 'var(--surface-2)',
            color: 'var(--text)',
            font: '600 13px var(--font-ui)',
            cursor: 'pointer',
          }}
        >
          Log out
        </button>
      )}
    </div>
  );
}

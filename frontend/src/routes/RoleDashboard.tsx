import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';

// Placeholder shell for /admin — RequireRole restricts this route to
// ADMIN before it ever renders, so there's nothing role-specific to do
// here beyond the title.
export function RoleDashboard({ title }: { title: string }) {
  const { user, logout } = useSession();
  const navigate = useNavigate();

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 24,
        padding: '48px 16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 440, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
          {user ? `Signed in as ${user.name} (${user.role})` : ''}
        </span>
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
          Dashboard
        </span>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.1, letterSpacing: '-0.03em', fontWeight: 600 }}>
          {title}
        </h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-muted)' }}>
          This is a placeholder screen — the real {title.toLowerCase()} experience isn't built yet.
        </p>
      </div>

      {user && (
        <div style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            type="button"
            onClick={() => navigate('/account')}
            style={{
              height: 44,
              borderRadius: 'var(--radius-control)',
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--accent-2)',
              font: '600 13px var(--font-ui)',
              cursor: 'pointer',
            }}
          >
            My account
          </button>
          <button
            type="button"
            onClick={() => void logout()}
            style={{
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
        </div>
      )}
    </div>
  );
}

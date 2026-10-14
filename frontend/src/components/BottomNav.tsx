import type { CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// Transcribed from Main.dc.html's bottom nav. Search and Trips are real,
// route-aware tabs now that both /search and /trips exist; Chat and Saathi
// AI stay visually present but inert, since neither screen is built yet.
export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  const inactiveItems = [
    { label: 'Chat', path: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z' },
    { label: 'Saathi AI', path: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8Z' },
  ];

  function tabStyle(active: boolean): CSSProperties {
    return {
      width: 64,
      height: 48,
      borderRadius: 14,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3,
      border: 0,
      padding: 0,
      cursor: 'pointer',
      color: active ? 'var(--accent)' : 'var(--text-muted)',
      background: active ? 'rgba(46,230,246,.08)' : 'transparent',
    };
  }

  const searchActive = location.pathname === '/search';
  const tripsActive = location.pathname === '/trips';

  return (
    <nav
      style={{
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: 12,
        maxWidth: 366,
        margin: '0 auto',
        height: 64,
        borderRadius: 22,
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        boxShadow: '0 -10px 30px rgba(0,0,0,.3)',
      }}
    >
      <button
        type="button"
        aria-label="Search"
        aria-current={searchActive ? 'page' : undefined}
        onClick={() => navigate('/search')}
        style={tabStyle(searchActive)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span style={{ font: '600 10px var(--font-ui)' }}>Search</span>
      </button>

      <button
        type="button"
        aria-label="Trips"
        aria-current={tripsActive ? 'page' : undefined}
        onClick={() => navigate('/trips')}
        style={tabStyle(tripsActive)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        <span style={{ font: '600 10px var(--font-ui)' }}>Trips</span>
      </button>

      {inactiveItems.map((item) => (
        <span
          key={item.label}
          aria-label={item.label}
          aria-disabled="true"
          title="Not available yet"
          style={{
            width: 64,
            height: 48,
            borderRadius: 14,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
            color: 'var(--text-muted)',
            opacity: 0.5,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d={item.path} />
          </svg>
          <span style={{ font: '500 10px var(--font-ui)' }}>{item.label}</span>
        </span>
      ))}
    </nav>
  );
}

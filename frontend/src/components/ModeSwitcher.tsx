import { useNavigate } from 'react-router-dom';
import type { CSSProperties } from 'react';

// Lets a DRIVER move between the passenger hub (/app) and the driver hub
// (/driver) without logging out — only rendered for drivers, since a
// PASSENGER has no driver mode to switch into.
export function ModeSwitcher({ active }: { active: 'passenger' | 'driver' }) {
  const navigate = useNavigate();

  function tabStyle(selected: boolean): CSSProperties {
    return {
      flex: 1,
      height: 36,
      borderRadius: 10,
      border: 0,
      cursor: 'pointer',
      background: selected ? 'var(--accent)' : 'transparent',
      color: selected ? 'var(--accent-on)' : 'var(--text-2)',
      font: '600 12px var(--font-ui)',
    };
  }

  return (
    <div
      role="tablist"
      aria-label="Switch experience"
      style={{
        display: 'flex',
        gap: 6,
        padding: 4,
        borderRadius: 14,
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
      }}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active === 'passenger'}
        onClick={() => navigate('/app')}
        style={tabStyle(active === 'passenger')}
      >
        Passenger
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'driver'}
        onClick={() => navigate('/driver')}
        style={tabStyle(active === 'driver')}
      >
        Driver
      </button>
    </div>
  );
}

import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/cn';

// Lets a DRIVER move between the passenger hub (/app) and the driver hub
// (/driver) without logging out — only rendered for drivers, since a
// PASSENGER has no driver mode to switch into.
export function ModeSwitcher({ active }: { active: 'passenger' | 'driver' }) {
  const navigate = useNavigate();

  function tabClass(selected: boolean): string {
    return cn(
      'h-9 flex-1 rounded-lg text-xs font-semibold transition-colors',
      selected ? 'bg-accent-700 text-white' : 'bg-transparent text-ink-muted',
    );
  }

  return (
    <div
      role="tablist"
      aria-label="Switch experience"
      className="flex gap-1.5 rounded-xl border border-border-strong bg-slate-50 p-1"
    >
      <button
        type="button"
        role="tab"
        aria-selected={active === 'passenger'}
        onClick={() => navigate('/app')}
        className={tabClass(active === 'passenger')}
      >
        Passenger
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'driver'}
        onClick={() => navigate('/driver')}
        className={tabClass(active === 'driver')}
      >
        Driver
      </button>
    </div>
  );
}

import { useLocation, useNavigate } from 'react-router-dom';
import { cn } from '../lib/cn';

// Transcribed from Main.dc.html's bottom nav. All four tabs are real,
// route-aware now that /search, /trips, /messages and /support all exist.
export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = [
    { label: 'Chat', path: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z', to: '/messages' },
    { label: 'Saathi AI', path: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8Z', to: '/support' },
  ];

  function tabClass(active: boolean): string {
    return cn(
      'flex h-12 w-16 flex-col items-center justify-center gap-0.5 rounded-xl border-0 p-0',
      active ? 'bg-accent-50 text-accent-700' : 'bg-transparent text-ink-muted',
    );
  }

  const searchActive = location.pathname === '/search';
  const tripsActive = location.pathname === '/trips';

  return (
    <nav className="fixed inset-x-3 bottom-3 mx-auto flex h-16 max-w-[366px] items-center justify-around rounded-[22px] border border-border-strong bg-surface shadow-lg">
      <button
        type="button"
        aria-label="Search"
        aria-current={searchActive ? 'page' : undefined}
        onClick={() => navigate('/search')}
        className={tabClass(searchActive)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span className="text-[10px] font-semibold">Search</span>
      </button>

      <button
        type="button"
        aria-label="Trips"
        aria-current={tripsActive ? 'page' : undefined}
        onClick={() => navigate('/trips')}
        className={tabClass(tripsActive)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        <span className="text-[10px] font-semibold">Trips</span>
      </button>

      {navItems.map((item) => (
        <button
          key={item.label}
          type="button"
          aria-label={item.label}
          aria-current={location.pathname.startsWith(item.to) ? 'page' : undefined}
          onClick={() => navigate(item.to)}
          className={tabClass(location.pathname.startsWith(item.to))}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d={item.path} />
          </svg>
          <span className="text-[10px] font-medium">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

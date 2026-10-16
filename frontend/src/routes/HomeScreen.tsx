import { Car, MapPinned, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import { ModeSwitcher } from '../components/ModeSwitcher';
import { BottomNav } from '../components/BottomNav';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

// Landing page for both PASSENGER and DRIVER (see roleHomePath) — a driver
// is never forced into a driver-only dashboard, so "Offer a ride" appears
// alongside "Find a ride" here instead of replacing it. Identity/account
// access lives in AppShell's header now, not duplicated here.
export function HomeScreen() {
  const { user } = useSession();
  const navigate = useNavigate();
  const isDriver = user?.role === 'DRIVER';

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 pb-24">
      {isDriver && <ModeSwitcher active="passenger" />}

      <Card className="p-6">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-700">
            <MapPinned size={20} aria-hidden />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Where to?</h1>
        </div>
        <p className="mt-3 text-sm text-ink-muted">
          {isDriver
            ? 'Find a seat on someone else’s ride, or offer one of your own.'
            : 'Search for a ride and book a seat.'}
        </p>
      </Card>

      <div className="flex flex-col gap-3">
        <Button size="lg" className="h-14 text-base" onClick={() => navigate('/search')}>
          <Search size={19} aria-hidden />
          Find a ride
        </Button>

        {isDriver && (
          <Button
            variant="secondary"
            size="lg"
            className="h-14 border-violet-200 bg-violet-50 text-base text-violet-700 hover:bg-violet-100"
            onClick={() => navigate('/driver')}
          >
            <Car size={19} aria-hidden />
            Offer a ride
          </Button>
        )}
      </div>

      <BottomNav />
    </div>
  );
}

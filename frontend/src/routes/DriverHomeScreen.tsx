import { useNavigate } from 'react-router-dom';
import { ModeSwitcher } from '../components/ModeSwitcher';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

// Driver-only hub (RequireRole restricts this to DRIVER) — links into
// OfferRideScreen and DriverRidesScreen below. ModeSwitcher always leaves a
// way back to the passenger side. Identity/account access lives in
// AppShell's header now, not duplicated here.
export function DriverHomeScreen() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5">
      <ModeSwitcher active="driver" />

      <Card className="p-6">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent-700">
          Driver
        </span>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Offer a ride</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Post a trip you're already taking and let passengers book seats on it, then start,
          complete, or cancel it from My rides. Switch to passenger mode above to search and book
          instead.
        </p>
      </Card>

      <div className="flex flex-col gap-3">
        <Button size="lg" className="h-14 text-base" onClick={() => navigate('/driver/offer')}>
          Offer a ride
        </Button>
        <Button variant="secondary" onClick={() => navigate('/driver/rides')}>
          My rides
        </Button>
        <Button variant="secondary" onClick={() => navigate('/driver/vehicle')}>
          My vehicle
        </Button>
        <Button variant="secondary" onClick={() => navigate('/app')}>
          Find a ride instead
        </Button>
      </div>
    </div>
  );
}

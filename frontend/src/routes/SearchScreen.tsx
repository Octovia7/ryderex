import { ArrowRightLeft, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RoutePreview } from '../components/RoutePreview';
import { LocationField } from '../components/LocationField';
import type { LocationValue } from '../components/LocationField';
import { BottomNav } from '../components/BottomNav';
import { Button } from '../components/ui/Button';
import { cn } from '../lib/cn';
import { upcomingKolkataDates } from '../utils/kolkataDate';

const EMPTY_LOCATION: LocationValue = { label: '', lat: null, lng: null };
const DATE_OPTIONS = upcomingKolkataDates(4);

// The backend's real, fixed search radius (SEARCH_RADIUS_METERS in
// src/modules/ride/repositories/rideSearchRepository.ts) — not a request
// parameter, so this is a label, not a control.
const SEARCH_RADIUS_LABEL = '10 km';

export function SearchScreen() {
  const navigate = useNavigate();

  const [pickup, setPickup] = useState<LocationValue>(EMPTY_LOCATION);
  const [drop, setDrop] = useState<LocationValue>(EMPTY_LOCATION);
  const [dateIndex, setDateIndex] = useState(0);
  // Not sent to GET /rides/search — the backend's search query has no seats
  // parameter at all (it already filters to availableSeats > 0 server-side).
  // Carried forward only for the booking step that comes after this one.
  const [seats, setSeats] = useState(1);

  const canSearch = pickup.lat !== null && pickup.lng !== null && drop.lat !== null && drop.lng !== null;

  function handleSwap() {
    setPickup(drop);
    setDrop(pickup);
  }

  function handleSearch() {
    if (!canSearch) return;
    const params = new URLSearchParams({
      date: DATE_OPTIONS[dateIndex].dateStr,
      pickupLat: String(pickup.lat),
      pickupLng: String(pickup.lng),
      destinationLat: String(drop.lat),
      destinationLng: String(drop.lng),
      pickupLabel: pickup.label,
      dropLabel: drop.label,
      seats: String(seats),
    });
    navigate(`/results?${params.toString()}`);
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 pb-24">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-ink">
          Where are you
          <br />
          headed today?
        </h1>
        <p className="text-sm text-ink-muted">Share a ride with drivers already going your way.</p>
      </div>

      <RoutePreview />

      <div className="rounded-xl border border-border-strong bg-surface px-4">
        <div className="border-b border-border-subtle">
          <LocationField
            label="PICKUP"
            placeholder="Search pickup point"
            value={pickup}
            onChange={setPickup}
            dotColor="accent"
            dotShape="circle"
          />
        </div>
        <div className="relative">
          <LocationField
            label="DROP"
            placeholder="Search drop point"
            value={drop}
            onChange={setDrop}
            dotColor="accent-2"
            dotShape="square"
          />
          <button
            type="button"
            aria-label="Swap pickup and drop"
            onClick={handleSwap}
            className="absolute right-0 top-3 flex size-11 items-center justify-center rounded-xl border border-border-strong bg-slate-50"
          >
            <ArrowRightLeft className="size-[18px] text-accent-700" aria-hidden />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <span className="font-mono text-[10px] tracking-wider text-ink-muted">DATE</span>
        <div className="flex gap-2">
          {DATE_OPTIONS.map((option, index) => {
            const on = index === dateIndex;
            return (
              <button
                key={option.dateStr}
                type="button"
                onClick={() => setDateIndex(index)}
                className={cn(
                  'flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border transition-colors',
                  on ? 'border-accent-700 bg-accent-50 text-ink' : 'border-border-strong bg-surface text-ink-muted',
                )}
              >
                <span className="text-sm font-semibold">{option.label}</span>
                <span className="font-mono text-xs opacity-80">{option.sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2.5">
        <div className="flex flex-1 items-center justify-between rounded-xl border border-border-strong bg-surface py-1.5 pl-3.5 pr-1.5">
          <span className="text-sm text-ink">Seats</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Fewer seats"
              onClick={() => setSeats((s) => Math.max(1, s - 1))}
              className="flex size-11 items-center justify-center rounded-lg border border-border-strong bg-slate-50 text-lg text-ink"
            >
              −
            </button>
            <span className="w-7 text-center font-mono text-lg font-semibold text-accent-700">{seats}</span>
            <button
              type="button"
              aria-label="More seats"
              onClick={() => setSeats((s) => Math.min(4, s + 1))}
              className="flex size-11 items-center justify-center rounded-lg border border-border-strong bg-slate-50 text-lg text-ink"
            >
              +
            </button>
          </div>
        </div>
        <div className="flex flex-col justify-center rounded-xl border border-border-strong bg-surface px-3.5">
          <span className="font-mono text-[10px] tracking-wider text-ink-muted">RADIUS</span>
          <span className="font-mono text-sm font-semibold text-ink">{SEARCH_RADIUS_LABEL}</span>
        </div>
      </div>

      <Button
        size="lg"
        className="h-14 text-base"
        disabled={!canSearch}
        onClick={handleSearch}
      >
        Find rides
        <ArrowRight className="size-5" aria-hidden />
      </Button>
      {!canSearch && (
        <p className="-mt-2 text-center text-xs text-ink-muted">
          Pick a pickup and drop point from the suggestions to search.
        </p>
      )}

      <BottomNav />
    </div>
  );
}

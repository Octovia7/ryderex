import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSession } from '../auth/session';
import { withAuthRetry } from '../api/withAuthRetry';
import { searchRides, RIDE_SORTS } from '../api/rides';
import type { RideSearchItem, RideSort } from '../api/rides';
import { ApiError } from '../api/client';
import { Button } from '../components/ui/Button';
import { cn } from '../lib/cn';

const SORT_LABELS: Record<RideSort, string> = {
  DEPARTURE_TIME: 'Departure',
  PICKUP_DISTANCE: 'Nearest pickup',
  DESTINATION_DISTANCE: 'Nearest drop',
  FARE: 'Lowest fare',
  DRIVER_RATING: 'Top rated',
};

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function km(meters: number): string {
  return (meters / 1000).toFixed(1);
}

export function ResultsScreen() {
  const session = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const date = searchParams.get('date');
  const pickupLat = searchParams.get('pickupLat');
  const pickupLng = searchParams.get('pickupLng');
  const destinationLat = searchParams.get('destinationLat');
  const destinationLng = searchParams.get('destinationLng');
  const pickupLabel = searchParams.get('pickupLabel') ?? 'Pickup';
  const dropLabel = searchParams.get('dropLabel') ?? 'Drop';
  const seats = Number(searchParams.get('seats') ?? '1');

  const hasValidParams = Boolean(date && pickupLat && pickupLng && destinationLat && destinationLng);

  const [sort, setSort] = useState<RideSort>('DEPARTURE_TIME');
  const [items, setItems] = useState<RideSearchItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasValidParams) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    withAuthRetry(session, (token) =>
      searchRides(
        {
          date: date!,
          pickupLat: Number(pickupLat),
          pickupLng: Number(pickupLng),
          destinationLat: Number(destinationLat),
          destinationLng: Number(destinationLng),
          sort,
        },
        token,
      ),
    )
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Intentionally excludes `session` (stable per-render identity from
    // context isn't meant to retrigger search) — only the actual query
    // inputs should.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, pickupLat, pickupLng, destinationLat, destinationLng, sort, hasValidParams]);

  function handleLoadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    withAuthRetry(session, (token) =>
      searchRides(
        {
          date: date!,
          pickupLat: Number(pickupLat),
          pickupLng: Number(pickupLng),
          destinationLat: Number(destinationLat),
          destinationLng: Number(destinationLng),
          sort,
          cursor: nextCursor,
        },
        token,
      ),
    )
      .then((page) => {
        setItems((current) => [...current, ...page.items]);
        setNextCursor(page.nextCursor);
      })
      .catch((cause) => {
        setError(cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.');
      })
      .finally(() => setLoadingMore(false));
  }

  function openRide(item: RideSearchItem) {
    navigate(`/rides/${item.id}`, {
      state: { searchItem: item, pickupLabel, dropLabel, seats },
    });
  }

  if (!hasValidParams) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-sm text-ink-muted">No search to show — start a new search.</p>
        <Button onClick={() => navigate('/search')}>Back to search</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <div className="flex flex-col gap-3.5 rounded-xl border border-border-subtle bg-surface p-4">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            aria-label="Back to search"
            onClick={() => navigate('/search')}
            className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border-strong bg-slate-50"
          >
            <ChevronLeft className="size-[18px] text-ink" aria-hidden />
          </button>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg border border-border-strong bg-slate-50 px-3 py-2">
            <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap text-sm font-semibold text-ink">
              <span className="size-1.5 shrink-0 rounded-full bg-accent-600" />
              <span className="overflow-hidden text-ellipsis">{pickupLabel}</span>
              <span className="text-ink-muted">→</span>
              <span className="size-1.5 shrink-0 rounded-sm bg-violet-500" />
              <span className="overflow-hidden text-ellipsis">{dropLabel}</span>
            </div>
            <span className="font-mono text-xs text-ink-muted">
              {date} · {seats} seat{seats === 1 ? '' : 's'} · 10 km radius
            </span>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {RIDE_SORTS.map((s) => {
            const on = s === sort;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSort(s)}
                className={cn(
                  'h-9 shrink-0 rounded-full border px-3.5 text-xs font-medium transition-colors',
                  on ? 'border-accent-700 bg-accent-50 text-ink' : 'border-border-strong bg-slate-50 text-ink-muted',
                )}
              >
                {SORT_LABELS[s]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {loading && <p className="py-12 text-center text-sm text-ink-muted">Searching rides…</p>}

        {!loading && error && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-700">{error}</div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="flex flex-col gap-2 py-12 text-center">
            <p className="text-sm font-semibold text-ink">No rides found</p>
            <p className="text-xs text-ink-muted">
              No rides match this route and date yet. Try a different date or widen your pickup/drop.
            </p>
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <>
            <span className="text-xs text-ink-muted">
              <span className="font-semibold text-ink">{items.length} ride{items.length === 1 ? '' : 's'}</span> match both pickup and drop
            </span>

            {items.map((ride) => (
              <button
                key={ride.id}
                type="button"
                onClick={() => openRide(ride)}
                className="flex flex-col gap-3.5 rounded-xl border border-border-subtle bg-surface p-4 text-left shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-2xl font-semibold tracking-tight text-ink">
                      {formatTime(ride.departureTime)}
                    </span>
                    <span className="font-mono text-xs text-ink-muted">{ride.vehicle.vehicleType}</span>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="text-xl font-bold text-accent-700">₹{ride.farePerSeat}</span>
                    <span className="font-mono text-xs text-ink-muted">per seat</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-100 text-sm font-semibold text-accent-800">
                    {ride.driver.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                      {ride.driver.name}
                      <span
                        className={cn(
                          'inline-flex items-center gap-0.5 font-mono text-xs',
                          ride.driver.ratingAverage == null ? 'text-violet-600' : 'text-amber-600',
                        )}
                      >
                        ★ {ride.driver.ratingAverage == null ? 'New' : ride.driver.ratingAverage.toFixed(1)}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {ride.vehicle.model && (
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-ink-muted">
                          {ride.vehicle.model}
                        </span>
                      )}
                      {ride.vehicle.isAc && (
                        <span className="rounded-md bg-accent-50 px-2 py-0.5 font-mono text-xs text-accent-700">
                          AC
                        </span>
                      )}
                    </span>
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <span className="flex justify-between font-mono text-xs text-ink-muted">
                    <span>pickup</span>
                    <span className="text-ink">{km(ride.pickupDistanceMeters)} km</span>
                  </span>
                  <span className="flex justify-between font-mono text-xs text-ink-muted">
                    <span>drop</span>
                    <span className="text-ink">{km(ride.destinationDistanceMeters)} km</span>
                  </span>
                </div>

                <div className="flex items-center justify-between border-t border-dashed border-border-subtle pt-3">
                  <span className={cn('font-mono text-xs', ride.availableSeats === 1 ? 'text-amber-600' : 'text-ink-muted')}>
                    {ride.availableSeats === 1 ? 'Last seat' : `${ride.availableSeats} seats left`}
                  </span>
                  <span className="flex items-center gap-1 text-sm font-semibold text-accent-700">
                    View ride
                    <ChevronRight className="size-3.5" aria-hidden />
                  </span>
                </div>
              </button>
            ))}

            {nextCursor && (
              <Button
                variant="ghost"
                className="border border-dashed border-border-strong"
                loading={loadingMore}
                onClick={handleLoadMore}
              >
                Load more rides
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

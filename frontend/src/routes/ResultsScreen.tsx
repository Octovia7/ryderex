import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSession } from '../auth/session';
import { withAuthRetry } from '../api/withAuthRetry';
import { searchRides, RIDE_SORTS } from '../api/rides';
import type { RideSearchItem, RideSort } from '../api/rides';
import { ApiError } from '../api/client';

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
      <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: 'var(--text)', fontFamily: 'var(--font-ui)', padding: 24, textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>No search to show — start a new search.</p>
        <button
          type="button"
          onClick={() => navigate('/search')}
          style={{ height: 48, padding: '0 24px', borderRadius: 14, border: 0, background: 'var(--accent)', color: 'var(--accent-on)', font: '600 14px var(--font-ui)', cursor: 'pointer' }}
        >
          Back to search
        </button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-ui)', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          padding: '16px 16px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--surface-1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            aria-label="Back to search"
            onClick={() => navigate('/search')}
            style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <div style={{ flex: 1, minWidth: 0, padding: '8px 12px', borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{pickupLabel}</span>
              <span style={{ color: 'var(--text-muted)' }}>→</span>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: 'var(--accent-2)', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{dropLabel}</span>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
              {date} · {seats} seat{seats === 1 ? '' : 's'} · 10 km radius
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
          {RIDE_SORTS.map((s) => {
            const on = s === sort;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSort(s)}
                style={{
                  flexShrink: 0,
                  height: 36,
                  padding: '0 14px',
                  borderRadius: 999,
                  cursor: 'pointer',
                  font: '500 13px var(--font-ui)',
                  background: on ? 'rgba(46,230,246,.12)' : 'var(--surface-2)',
                  color: on ? 'var(--text)' : 'var(--text-2)',
                  border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                }}
              >
                {SORT_LABELS[s]}
              </button>
            );
          })}
        </div>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading && (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '48px 0' }}>Searching rides…</p>
        )}

        {!loading && error && (
          <div style={{ padding: 16, borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--warning-border)', color: 'var(--warning)', fontSize: 14 }}>
            {error}
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '48px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>No rides found</p>
            <p style={{ margin: 0, fontSize: 13 }}>
              No rides match this route and date yet. Try a different date or widen your pickup/drop.
            </p>
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{items.length} ride{items.length === 1 ? '' : 's'}</span> match both pickup and drop
              </span>
            </div>

            {items.map((ride) => (
              <button
                key={ride.id}
                type="button"
                onClick={() => openRide(ride)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  padding: 16,
                  borderRadius: 22,
                  background: 'var(--surface-1)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text)',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ font: '600 26px var(--font-mono)', letterSpacing: '-0.02em' }}>{formatTime(ride.departureTime)}</span>
                    <span style={{ font: '400 11px var(--font-mono)', color: 'var(--text-muted)' }}>{ride.vehicle.vehicleType}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                    <span style={{ font: '700 22px var(--font-ui)', color: 'var(--accent)' }}>₹{ride.farePerSeat}</span>
                    <span style={{ font: '400 11px var(--font-mono)', color: 'var(--text-muted)' }}>per seat</span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 40, height: 40, borderRadius: '50%', padding: 2, background: 'conic-gradient(var(--accent), var(--accent-2), var(--accent))', flexShrink: 0 }}>
                    <span style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '600 14px var(--font-ui)' }}>
                      {ride.driver.name.slice(0, 2).toUpperCase()}
                    </span>
                  </span>
                  <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600 }}>
                      {ride.driver.name}
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, font: '500 12px var(--font-mono)', color: ride.driver.ratingAverage == null ? 'var(--accent-2)' : 'var(--star)' }}>
                        ★ {ride.driver.ratingAverage == null ? 'New' : ride.driver.ratingAverage.toFixed(1)}
                      </span>
                    </span>
                    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {ride.vehicle.model && (
                        <span style={{ font: '500 11px var(--font-mono)', padding: '3px 8px', borderRadius: 8, background: 'var(--surface-3)', color: 'var(--text-2)' }}>
                          {ride.vehicle.model}
                        </span>
                      )}
                      {ride.vehicle.isAc && (
                        <span style={{ font: '500 11px var(--font-mono)', padding: '3px 8px', borderRadius: 8, background: 'rgba(46,230,246,.1)', color: 'var(--accent)' }}>
                          AC
                        </span>
                      )}
                    </span>
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ display: 'flex', justifyContent: 'space-between', font: '400 11px var(--font-mono)', color: 'var(--text-muted)' }}>
                      <span>pickup</span>
                      <span style={{ color: 'var(--text)' }}>{km(ride.pickupDistanceMeters)} km</span>
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ display: 'flex', justifyContent: 'space-between', font: '400 11px var(--font-mono)', color: 'var(--text-muted)' }}>
                      <span>drop</span>
                      <span style={{ color: 'var(--text)' }}>{km(ride.destinationDistanceMeters)} km</span>
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px dashed var(--border-subtle)' }}>
                  <span style={{ font: '500 12px var(--font-mono)', color: ride.availableSeats === 1 ? 'var(--warning)' : 'var(--text-2)' }}>
                    {ride.availableSeats === 1 ? 'Last seat' : `${ride.availableSeats} seats left`}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                    View ride
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </span>
                </div>
              </button>
            ))}

            {nextCursor && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                style={{ height: 52, borderRadius: 16, background: 'transparent', border: '1px dashed var(--border)', color: 'var(--text-2)', font: '500 14px var(--font-ui)', cursor: loadingMore ? 'default' : 'pointer' }}
              >
                {loadingMore ? 'Loading…' : 'Load more rides'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

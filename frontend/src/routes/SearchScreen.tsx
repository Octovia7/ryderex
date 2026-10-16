import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import { RoutePreview } from '../components/RoutePreview';
import { LocationField } from '../components/LocationField';
import type { LocationValue } from '../components/LocationField';
import { BottomNav } from '../components/BottomNav';
import { upcomingKolkataDates } from '../utils/kolkataDate';

const EMPTY_LOCATION: LocationValue = { label: '', lat: null, lng: null };
const DATE_OPTIONS = upcomingKolkataDates(4);

// The backend's real, fixed search radius (SEARCH_RADIUS_METERS in
// src/modules/ride/repositories/rideSearchRepository.ts) — not a request
// parameter, so this is a label, not a control.
const SEARCH_RADIUS_LABEL = '10 km';

export function SearchScreen() {
  const { user } = useSession();
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
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
      <div style={{ maxWidth: 440, margin: '0 auto', padding: '20px 16px 100px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 11,
                background: 'var(--surface-2)',
                border: '1px solid var(--accent)',
                boxShadow: '0 0 18px rgba(11,129,147,.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 17 C 8 17, 8 7, 12 7 S 16 17, 20 17" />
                <circle cx="4" cy="17" r="2" />
                <circle cx="20" cy="17" r="2" />
              </svg>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>SaathiRide</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', letterSpacing: '.12em' }}>
                CARPOOL · INDIA
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => navigate('/account')}
              aria-label="Account"
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                border: 0,
                background: 'var(--surface-3)',
                color: 'var(--text)',
                font: '600 14px var(--font-ui)',
                cursor: 'pointer',
              }}
            >
              {user ? user.name.slice(0, 2).toUpperCase() : '??'}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.1, fontWeight: 600, letterSpacing: '-0.03em' }}>
            Where are you
            <br />
            headed today?
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>
            Share a ride with drivers already going your way.
          </p>
        </div>

        <RoutePreview />

        <div style={{ borderRadius: 20, background: 'var(--surface-2)', border: '1px solid var(--border)', padding: '0 16px' }}>
          <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <LocationField
              label="PICKUP"
              placeholder="Search pickup point"
              value={pickup}
              onChange={setPickup}
              dotColor="accent"
              dotShape="circle"
            />
          </div>
          <div style={{ position: 'relative' }}>
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
              style={{
                position: 'absolute',
                right: 0,
                top: 12,
                width: 44,
                height: 44,
                borderRadius: 14,
                background: 'var(--surface-3)',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 4v16M7 4 3 8M7 4l4 4M17 20V4M17 20l-4-4M17 20l4-4" />
              </svg>
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.14em', color: 'var(--text-muted)' }}>
            DATE
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {DATE_OPTIONS.map((option, index) => {
              const on = index === dateIndex;
              return (
                <button
                  key={option.dateStr}
                  type="button"
                  onClick={() => setDateIndex(index)}
                  style={{
                    flex: 1,
                    height: 56,
                    borderRadius: 16,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                    background: on ? 'rgba(11,129,147,.12)' : 'var(--surface-2)',
                    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                    color: on ? 'var(--text)' : 'var(--text-2)',
                    boxShadow: on ? '0 0 18px rgba(11,129,147,.2)' : 'none',
                    transition: 'all .25s',
                  }}
                >
                  <span style={{ font: '600 13px var(--font-ui)' }}>{option.label}</span>
                  <span style={{ font: '500 11px var(--font-mono)', opacity: 0.8 }}>{option.sub}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 6px 6px 14px',
              borderRadius: 16,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
            }}
          >
            <span style={{ fontSize: 14, color: 'var(--text-2)' }}>Seats</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                aria-label="Fewer seats"
                onClick={() => setSeats((s) => Math.max(1, s - 1))}
                style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 20, cursor: 'pointer' }}
              >
                −
              </button>
              <span style={{ width: 28, textAlign: 'center', font: '600 18px var(--font-mono)', color: 'var(--accent)' }}>{seats}</span>
              <button
                type="button"
                aria-label="More seats"
                onClick={() => setSeats((s) => Math.min(4, s + 1))}
                style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--surface-3)', border: '1px solid var(--border)', color: 'var(--text)', fontSize: 20, cursor: 'pointer' }}
              >
                +
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 14px', borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.12em', color: 'var(--text-muted)' }}>RADIUS</span>
            <span style={{ font: '600 15px var(--font-mono)', color: 'var(--text)' }}>{SEARCH_RADIUS_LABEL}</span>
          </div>
        </div>

        <button
          type="button"
          disabled={!canSearch}
          onClick={handleSearch}
          style={{
            height: 58,
            borderRadius: 18,
            border: 0,
            cursor: canSearch ? 'pointer' : 'not-allowed',
            background: canSearch ? 'var(--accent)' : 'var(--surface-3)',
            color: canSearch ? 'var(--accent-on)' : 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            font: '700 17px var(--font-ui)',
            boxShadow: canSearch ? 'var(--accent-glow)' : 'none',
          }}
        >
          Find rides
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
        {!canSearch && (
          <p style={{ margin: '-8px 0 0', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
            Pick a pickup and drop point from the suggestions to search.
          </p>
        )}
      </div>
      <BottomNav />
    </div>
  );
}

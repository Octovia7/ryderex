import L from 'leaflet';
import { useEffect, useRef } from 'react';

import 'leaflet/dist/leaflet.css';

import { cn } from '../lib/cn';

export interface MapPoint {
  lat: number;
  lng: number;
  label: string;
  kind: 'origin' | 'destination';
}

interface RouteMapProps {
  // The ride's own routeGeometry — real, road-following coordinates from
  // the backend's map provider at ride-creation time (GeoapifyMapProvider),
  // not a straight line and not decorative.
  routeGeometry: { lat: number; lng: number }[];
  points: MapPoint[];
  height?: number;
  className?: string;
}

// Leaflet's default marker icons resolve from a CDN path a bundler rewrites,
// so they 404 silently. A small inline SVG-free div icon avoids that
// entirely and lets origin/destination be told apart by colour, the same
// dot convention already used throughout this app (teal circle = pickup,
// violet square = drop).
const PIN_COLORS: Record<MapPoint['kind'], string> = {
  origin: '#0b8193',
  destination: '#8b5cf6',
};

function pinIcon(kind: MapPoint['kind']): L.DivIcon {
  const color = PIN_COLORS[kind];
  const shape = kind === 'origin' ? '9999px' : '4px';

  return L.divIcon({
    className: '',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: `<span style="display:block;width:18px;height:18px;border-radius:${shape};background:${color};border:3px solid #ffffff;box-shadow:0 0 0 1px ${color}"></span>`,
  });
}

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Driven directly rather than through a React wrapper: the map is read-only
// and never re-renders from component state, so an imperative setup inside
// one effect is simpler than a tree of wrapper components — this project
// has no other map usage to share a pattern with.
export function RouteMap({ routeGeometry, points, height = 240, className }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || routeGeometry.length === 0) return;

    const map = L.map(container, {
      // A map embedded inside a scrolling page must not swallow the wheel;
      // clicking the map first enables zoom, Leaflet's own default pattern.
      scrollWheelZoom: false,
      attributionControl: true,
    });

    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);

    const latLngs: L.LatLngExpression[] = routeGeometry.map((point) => [point.lat, point.lng]);
    const route = L.polyline(latLngs, { color: '#0b8193', weight: 4, opacity: 0.85 }).addTo(map);

    for (const point of points) {
      L.marker([point.lat, point.lng], { icon: pinIcon(point.kind) })
        .addTo(map)
        .bindTooltip(point.label, { direction: 'top', offset: [0, -8] });
    }

    const bounds = route.getBounds();
    for (const point of points) bounds.extend([point.lat, point.lng]);
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28] });

    // The container is often sized by a parent that settles after mount (a
    // just-opened detail panel); without this the tiles render against a
    // stale size and leave grey gaps until the next manual resize.
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      map.remove();
    };
  }, [routeGeometry, points]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="Map showing the ride's actual route, pickup and drop-off points"
      style={{ height }}
      className={cn('w-full rounded-xl border border-border-subtle', className)}
    />
  );
}

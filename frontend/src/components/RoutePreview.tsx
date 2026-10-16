import './RoutePreview.css';

// Transcribed from Main.dc.html / RideDetail.dc.html's route graphic — a
// decorative, schematic route preview (not a real map), reused by both
// screens so the look stays in one place.
export function RoutePreview({ height = 160 }: { height?: number }) {
  const w = 358;
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-sm"
      style={{ height }}
    >
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="absolute inset-0">
        <defs>
          <linearGradient id="sr-route-gradient" x1="0" x2="1">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <path
          d="M40 128 C 90 120, 110 70, 170 74 S 250 40, 318 34"
          stroke="url(#sr-route-gradient)"
          strokeWidth={3}
          fill="none"
          opacity={0.35}
        />
        <path
          className="sr-route"
          d="M40 128 C 90 120, 110 70, 170 74 S 250 40, 318 34"
          stroke="url(#sr-route-gradient)"
          strokeWidth={3}
          fill="none"
          strokeLinecap="round"
        />
        <circle className="sr-ping" cx={40} cy={128} r={9} fill="none" stroke="var(--accent)" strokeWidth={2} />
        <circle cx={40} cy={128} r={6} fill="var(--accent)" />
        <circle className="sr-ping" cx={318} cy={34} r={9} fill="none" stroke="var(--accent-2)" strokeWidth={2} />
        <rect x={312} y={28} width={12} height={12} rx={3} fill="var(--accent-2)" />
      </svg>
    </div>
  );
}

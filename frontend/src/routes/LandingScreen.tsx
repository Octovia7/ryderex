import type { CSSProperties } from 'react';
import {
  BadgeCheck,
  Car,
  IdCard,
  Leaf,
  MessageSquare,
  Search,
  ShieldCheck,
  Sprout,
  Star,
  Wallet,
} from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';

const sectionWrap: CSSProperties = {
  width: '100%',
  maxWidth: 880,
  margin: '0 auto',
  padding: '0 20px',
  boxSizing: 'border-box',
};

const gridAutoFit = (min: number): CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
  gap: 16,
});

const heroWrap: CSSProperties = {
  width: '100%',
  maxWidth: 1040,
  margin: '0 auto',
  padding: '0 20px',
  boxSizing: 'border-box',
};

const ecoStats = [
  { Icon: Sprout, label: 'Reduced emissions', value: '1.2 tons CO₂' },
  { Icon: Star, label: 'Reputation score', value: '4.8 / 5' },
];

const card: CSSProperties = {
  borderRadius: 'var(--radius-card)',
  background: 'var(--surface-1)', boxShadow: 'var(--card-shadow)',
  border: '1px solid var(--border-subtle)',
  padding: 24,
};

const sectionHeading: CSSProperties = {
  margin: '0 0 8px',
  fontSize: 22,
  lineHeight: 1.2,
  letterSpacing: '-0.02em',
  fontWeight: 600,
};

const bodyText: CSSProperties = {
  margin: 0,
  fontSize: 15,
  lineHeight: 1.6,
  color: 'var(--text-muted)',
};

const steps = [
  {
    Icon: Search,
    title: 'Search your route',
    body: 'Tell us where you are going and when. Rydex matches drivers already making that journey, within 10 km of both ends of your trip.',
  },
  {
    Icon: BadgeCheck,
    title: 'Pick your driver',
    body: 'See their rating, the car, and how far the ride sits from your own pickup and drop-off before you commit.',
  },
  {
    Icon: Wallet,
    title: 'Reserve for a fraction',
    body: 'Pay a small deposit to hold your seat. The rest is only due once the trip is actually finished.',
  },
];

const safetyPoints = [
  {
    Icon: IdCard,
    title: 'Every driver is checked by a person',
    body: 'A driving licence is reviewed by hand before anyone can publish a ride — and again for the car itself, with its registration, insurance and pollution certificate.',
  },
  {
    Icon: Star,
    title: 'Ratings go both ways',
    body: 'Drivers rate passengers and passengers rate drivers, once the trip is done. Reputation is earned on both sides of the car.',
  },
  {
    Icon: MessageSquare,
    title: 'Agree the details first',
    body: 'Message your driver in the app to settle exactly where to meet, before the day of travel.',
  },
  {
    Icon: ShieldCheck,
    title: 'Money handled properly',
    body: 'Payments run through a payment gateway and are only ever confirmed by the gateway itself — never by the app taking your word for it.',
  },
];

export function LandingScreen() {
  const navigate = useNavigate();
  const { status } = useSession();

  // Already signed in — skip the marketing page and go straight into the app.
  if (status === 'authenticated') {
    return <Navigate to="/search" replace />;
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      <header
        style={{
          width: '100%',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '16px 20px',
        }}
      >
        <div
          style={{
            maxWidth: 640,
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span style={{ font: '700 20px var(--font-ui)', color: 'var(--accent-2)', letterSpacing: '-0.02em' }}>
            Rydex
          </span>
          <button
            type="button"
            onClick={() => navigate('/login')}
            style={{
              height: 40,
              padding: '0 18px',
              borderRadius: 'var(--radius-control)',
              border: '1px solid var(--border)',
              background: 'var(--surface-2)',
              color: 'var(--text)',
              font: '600 14px var(--font-ui)',
              cursor: 'pointer',
            }}
          >
            Sign in
          </button>
        </div>
      </header>

      <main style={{ display: 'flex', flexDirection: 'column', gap: 56, padding: '32px 0 72px' }}>
        {/* Hero: dark gradient banner with a floating eco-stat card, instead
            of a plain centered text block. */}
        <section style={heroWrap}>
          <div
            style={{
              position: 'relative',
              overflow: 'hidden',
              borderRadius: 'var(--radius-card)',
              background: 'linear-gradient(135deg, #0d3b3e 0%, #0f766e 55%, #114b3a 100%)',
              padding: 'clamp(28px, 5vw, 56px)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 32,
              alignItems: 'flex-end',
            }}
          >
            <div style={{ flex: '1 1 360px', maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  width: 'fit-content',
                  font: '600 12px var(--font-ui)',
                  color: '#d2f5ea',
                  background: 'rgba(255,255,255,.14)',
                  borderRadius: 'var(--radius-chip)',
                  padding: '6px 14px',
                  backdropFilter: 'blur(6px)',
                }}
              >
                <Leaf size={14} aria-hidden /> Sustainable commuting
              </span>
              <h1
                style={{
                  margin: 0,
                  fontSize: 'clamp(28px, 5vw, 44px)',
                  lineHeight: 1.08,
                  letterSpacing: '-0.03em',
                  fontWeight: 700,
                  color: '#ffffff',
                }}
              >
                Rydex: sustainable commuting for the conscious commuter
              </h1>
              <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: 'rgba(255,255,255,.82)' }}>
                Travel the route you were taking anyway, with people going the same way. Fewer cars, a
                cheaper trip, and a seat that would otherwise have gone empty.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  style={{
                    height: 52,
                    minWidth: 160,
                    padding: '0 24px',
                    borderRadius: 'var(--radius-control)',
                    border: 0,
                    background: '#ffffff',
                    color: '#0d3b3e',
                    font: '700 15px var(--font-ui)',
                    cursor: 'pointer',
                  }}
                >
                  Find a ride
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  style={{
                    height: 52,
                    minWidth: 160,
                    padding: '0 24px',
                    borderRadius: 'var(--radius-control)',
                    border: '1px solid rgba(255,255,255,.35)',
                    background: 'rgba(255,255,255,.12)',
                    color: '#ffffff',
                    font: '600 15px var(--font-ui)',
                    backdropFilter: 'blur(6px)',
                    cursor: 'pointer',
                  }}
                >
                  Offer a ride
                </button>
              </div>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,.7)' }}>
                No password — we email you a code to sign in.
              </span>
            </div>

            {/* Floating eco-leader example card */}
            <div
              style={{
                flex: '0 1 272px',
                maxWidth: 272,
                borderRadius: 'var(--radius-card)',
                background: 'rgba(255,255,255,.97)',
                border: '1px solid rgba(255,255,255,.4)',
                boxShadow: '0 20px 50px rgba(0,0,0,.25)',
                padding: 18,
                backdropFilter: 'blur(6px)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    font: '700 11px var(--font-ui)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: '#0f766e',
                  }}
                >
                  <Leaf size={13} aria-hidden /> Eco-leader status
                </span>
                <span
                  style={{
                    font: '600 10px var(--font-ui)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: 'var(--text-muted)',
                    background: 'var(--surface-3)',
                    borderRadius: 'var(--radius-chip)',
                    padding: '3px 9px',
                  }}
                >
                  Example
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
                {ecoStats.map(({ Icon, label, value }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Icon size={16} color="#0f766e" aria-hidden />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
                      <span style={{ font: '700 14px var(--font-ui)', color: 'var(--text)' }}>{value}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p
                style={{
                  margin: '12px 0 0',
                  paddingTop: 12,
                  borderTop: '1px solid var(--border-subtle)',
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: 'var(--text-muted)',
                }}
              >
                Every trip you share builds a rating both drivers and passengers can see.
              </p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section style={sectionWrap}>
          <h2 style={sectionHeading}>How it works</h2>
          <div style={{ ...gridAutoFit(220), marginTop: 20 }}>
            {steps.map(({ Icon, title, body }, i) => (
              <div key={title} style={card}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: 'rgba(11,129,147,.1)',
                      color: 'var(--accent)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      font: '700 12px var(--font-ui)',
                    }}
                  >
                    {i + 1}
                  </span>
                  <Icon size={17} color="var(--accent)" aria-hidden />
                </div>
                <h3 style={{ margin: '10px 0 4px', fontSize: 15, fontWeight: 600 }}>{title}</h3>
                <p style={{ ...bodyText, fontSize: 14 }}>{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Four people, one car */}
        <section style={sectionWrap}>
          <div
            style={{
              ...card,
              background: '#f0faf5',
              border: '1px solid #bfe8d2',
              display: 'flex',
              gap: 16,
              alignItems: 'flex-start',
              flexWrap: 'wrap',
            }}
          >
            <Leaf size={24} color="#0f766e" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
            <div style={{ flex: '1 1 260px' }}>
              <h2 style={sectionHeading}>Four people, one car</h2>
              <p style={bodyText}>
                A car going from Delhi to Jaipur burns the same fuel whether one person is in it or four.
                Filling the empty seats is the rare choice that costs everyone less and puts fewer cars on
                the highway at the same time — no new technology required, just a seat that would otherwise
                travel empty.
              </p>
            </div>
          </div>
        </section>

        {/* Safety */}
        <section style={sectionWrap}>
          <h2 style={sectionHeading}>Sharing a car with a stranger</h2>
          <p style={{ ...bodyText, marginBottom: 20 }}>
            It only works if it feels safe. Here is what Rydex actually does about that.
          </p>
          <div style={gridAutoFit(260)}>
            {safetyPoints.map(({ Icon, title, body }) => (
              <div key={title} style={{ ...card, display: 'flex', gap: 12 }}>
                <Icon size={18} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }} aria-hidden />
                <div>
                  <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 600 }}>{title}</h3>
                  <p style={{ ...bodyText, fontSize: 14 }}>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Driver CTA */}
        <section style={sectionWrap}>
          <div
            style={{
              ...card,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 20,
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ flex: '1 1 320px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Car size={19} color="var(--accent)" aria-hidden />
                <h2 style={{ ...sectionHeading, margin: 0 }}>Already making the trip?</h2>
              </div>
              <p style={{ ...bodyText, marginTop: 8 }}>
                Publish the journey you are taking anyway and sell the seats you are not using. Rydex works
                out a fair fare from your actual route, so you are not guessing what to charge. You will
                need your licence and your car’s papers verified first — both are reviewed by a person,
                once.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/login')}
              style={{
                flexShrink: 0,
                height: 48,
                padding: '0 24px',
                borderRadius: 'var(--radius-control)',
                border: 0,
                background: 'var(--accent)',
                color: 'var(--accent-on)',
                font: '700 14px var(--font-ui)',
                boxShadow: 'var(--accent-glow)',
                cursor: 'pointer',
              }}
            >
              Offer a ride
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

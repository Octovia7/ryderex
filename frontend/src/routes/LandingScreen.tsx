import type { CSSProperties } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';

const sectionWrap: CSSProperties = {
  width: '100%',
  maxWidth: 640,
  margin: '0 auto',
  padding: '0 20px',
  boxSizing: 'border-box',
};

const card: CSSProperties = {
  borderRadius: 'var(--radius-card)',
  background: 'var(--surface-1)',
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
    title: 'Search your route',
    body: 'Tell us where you are going and when. Rydex matches drivers already making that journey, within 10 km of both ends of your trip.',
  },
  {
    title: 'Pick your driver',
    body: 'See their rating, the car, and how far the ride sits from your own pickup and drop-off before you commit.',
  },
  {
    title: 'Reserve for a fraction',
    body: 'Pay a small deposit to hold your seat. The rest is only due once the trip is actually finished.',
  },
];

const safetyPoints = [
  {
    title: 'Every driver is checked by a person',
    body: 'A driving licence is reviewed by hand before anyone can publish a ride — and again for the car itself, with its registration, insurance and pollution certificate.',
  },
  {
    title: 'Ratings go both ways',
    body: 'Drivers rate passengers and passengers rate drivers, once the trip is done. Reputation is earned on both sides of the car.',
  },
  {
    title: 'Agree the details first',
    body: 'Message your driver in the app to settle exactly where to meet, before the day of travel.',
  },
  {
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

      <main style={{ display: 'flex', flexDirection: 'column', gap: 56, padding: '40px 0 72px' }}>
        {/* Hero */}
        <section style={sectionWrap}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
            <span
              style={{
                font: '600 12px var(--font-mono)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--accent-2)',
                background: 'var(--surface-2)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-chip)',
                padding: '6px 14px',
              }}
            >
              Sustainable commuting
            </span>
            <h1
              style={{
                margin: 0,
                fontSize: 'clamp(28px, 6vw, 40px)',
                lineHeight: 1.1,
                letterSpacing: '-0.03em',
                fontWeight: 700,
              }}
            >
              Rydex: sustainable commuting for the conscious commuter
            </h1>
            <p style={{ ...bodyText, maxWidth: 480 }}>
              Travel the route you were taking anyway, with people going the same way. Fewer cars, a
              cheaper trip, and a seat that would otherwise have gone empty.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => navigate('/login')}
                style={{
                  height: 52,
                  minWidth: 160,
                  padding: '0 24px',
                  borderRadius: 'var(--radius-control)',
                  border: 0,
                  background: 'var(--accent)',
                  color: 'var(--accent-on)',
                  font: '700 15px var(--font-ui)',
                  boxShadow: 'var(--accent-glow)',
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
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  color: 'var(--accent-2)',
                  font: '600 15px var(--font-ui)',
                  cursor: 'pointer',
                }}
              >
                Offer a ride
              </button>
            </div>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              No password — we email you a code to sign in.
            </span>
          </div>
        </section>

        {/* Eco-leader status example */}
        <section style={sectionWrap}>
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ font: '700 13px var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Eco-leader status
              </span>
              <span
                style={{
                  font: '600 11px var(--font-mono)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-chip)',
                  padding: '3px 10px',
                }}
              >
                Example
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
              <div style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Reduced emissions</span>
                <span style={{ font: '700 20px var(--font-ui)' }}>1.2 tons CO₂</span>
              </div>
              <div style={{ flex: '1 1 160px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Reputation score</span>
                <span style={{ font: '700 20px var(--font-ui)' }}>4.8 / 5</span>
              </div>
            </div>
            <p style={{ ...bodyText, marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
              Every trip you share builds a rating both drivers and passengers can see.
            </p>
          </div>
        </section>

        {/* How it works */}
        <section style={sectionWrap}>
          <h2 style={sectionHeading}>How it works</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 20 }}>
            {steps.map((step, i) => (
              <div key={step.title} style={{ display: 'flex', gap: 16 }}>
                <span
                  style={{
                    flexShrink: 0,
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    color: 'var(--accent-2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    font: '700 14px var(--font-ui)',
                  }}
                >
                  {i + 1}
                </span>
                <div>
                  <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>{step.title}</h3>
                  <p style={bodyText}>{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Four people, one car */}
        <section style={sectionWrap}>
          <div
            style={{
              ...card,
              background: 'var(--surface-2)',
            }}
          >
            <h2 style={sectionHeading}>Four people, one car</h2>
            <p style={bodyText}>
              A car going from Delhi to Jaipur burns the same fuel whether one person is in it or four.
              Filling the empty seats is the rare choice that costs everyone less and puts fewer cars on
              the highway at the same time — no new technology required, just a seat that would otherwise
              travel empty.
            </p>
          </div>
        </section>

        {/* Safety */}
        <section style={sectionWrap}>
          <h2 style={sectionHeading}>Sharing a car with a stranger</h2>
          <p style={{ ...bodyText, marginBottom: 20 }}>
            It only works if it feels safe. Here is what Rydex actually does about that.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {safetyPoints.map((point) => (
              <div key={point.title} style={card}>
                <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 600 }}>{point.title}</h3>
                <p style={bodyText}>{point.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Driver CTA */}
        <section style={sectionWrap}>
          <div style={{ ...card, textAlign: 'center' }}>
            <h2 style={sectionHeading}>Already making the trip?</h2>
            <p style={{ ...bodyText, margin: '0 auto 20px', maxWidth: 440 }}>
              Publish the journey you are taking anyway and sell the seats you are not using. Rydex works
              out a fair fare from your actual route, so you are not guessing what to charge. You will
              need your licence and your car’s papers verified first — both are reviewed by a person,
              once.
            </p>
            <button
              type="button"
              onClick={() => navigate('/login')}
              style={{
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

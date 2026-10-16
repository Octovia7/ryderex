import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import { roleHomePath, InvalidSessionError } from '../auth/roles';
import { ApiError } from '../api/client';
import './LoginScreen.css';

// Real backend defaults (src/config/env.ts) — not arbitrary UI numbers.
const OTP_TTL_SECONDS = 300;
const RESEND_COOLDOWN_SECONDS = 60;

// The exact string src/modules/auth/services/otpService.ts throws when an
// OTP is correct but the account doesn't exist yet and name/phone weren't
// sent. There's no dedicated error code for this — VALIDATION_ERROR covers
// every schema/business validation failure — so this is the only reliable
// signal to branch on. Fragile by nature of the backend's own contract,
// not a frontend shortcut.
const NEW_ACCOUNT_MESSAGE = 'name and phone are required to create a new account.';

type Step = 'email' | 'otp' | 'details';

function isValidEmail(value: string): boolean {
  return /.+@.+\..+/.test(value);
}

export function LoginScreen() {
  const session = useSession();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const [ttl, setTtl] = useState(OTP_TTL_SECONDS);
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const otpInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step !== 'otp' && step !== 'details') return;
    const interval = setInterval(() => {
      setTtl((current) => Math.max(0, current - 1));
      setCooldown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [step]);

  async function handleSendCode() {
    setError(null);
    setLoading(true);
    try {
      await session.requestOtp(email);
      setOtp('');
      setTtl(OTP_TTL_SECONDS);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setStep('otp');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (cooldown > 0) return;
    setError(null);
    setLoading(true);
    try {
      await session.requestOtp(email);
      setOtp('');
      setTtl(OTP_TTL_SECONDS);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function submitVerify(extra?: { name: string; phone: string }) {
    setError(null);
    setLoading(true);
    try {
      const user = await session.verifyOtp({ email, otp, ...(extra ?? {}) });
      // Every self-registered account is a PASSENGER (the backend has no
      // signup path for DRIVER/ADMIN), so a brand-new user lands on /app
      // the same way any other passenger does — this is one destination
      // rule, not "new user" vs. "returning user" branches.
      navigate(roleHomePath(user.role), { replace: true });
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        cause.code === 'VALIDATION_ERROR' &&
        cause.message === NEW_ACCOUNT_MESSAGE
      ) {
        // The OTP is still valid — the backend checks this before
        // consuming it — so the same code carries over to the details step.
        setStep('details');
        setLoading(false);
        return;
      }
      if (cause instanceof InvalidSessionError) {
        setError(cause.message);
        setLoading(false);
        return;
      }
      setError(cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  const otpValid = /^\d{6}$/.test(otp);
  const emailValid = isValidEmail(email);
  const detailsValid = name.trim().length > 0 && phone.trim().length > 0;

  const mm = Math.floor(ttl / 60);
  const ss = String(ttl % 60).padStart(2, '0');

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: 'var(--bg)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 390, display: 'flex', justifyContent: 'flex-end', padding: '16px 16px 0' }}>
      </div>

      <div
        style={{
          width: '100%',
          maxWidth: 390,
          color: 'var(--text)',
          fontFamily: 'var(--font-ui)',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
        }}
      >
        <div style={{ position: 'relative', height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            className="sr-orbit2"
            style={{
              position: 'absolute',
              width: 300,
              height: 300,
              borderRadius: '50%',
              border: '1px dashed var(--border)',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: -5,
                left: '50%',
                width: 10,
                height: 10,
                borderRadius: 3,
                background: 'var(--accent-2)',
                boxShadow: '0 0 14px var(--accent-2)',
              }}
            />
          </div>
          <div
            className="sr-orbit1"
            style={{
              position: 'absolute',
              width: 210,
              height: 210,
              borderRadius: '50%',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <span
              style={{
                position: 'absolute',
                bottom: 18,
                left: 14,
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: 'var(--accent)',
                boxShadow: '0 0 14px var(--accent)',
              }}
            />
            <span
              style={{
                position: 'absolute',
                top: 30,
                right: 6,
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--text)',
                opacity: 0.7,
              }}
            />
          </div>
          <div
            style={{
              position: 'relative',
              width: 104,
              height: 104,
              borderRadius: 32,
              background: 'var(--surface-2)',
              border: '1px solid var(--accent)',
              boxShadow: '0 0 50px rgba(46,230,246,.2), inset 0 0 26px rgba(46,230,246,.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 17 C 8 17, 8 7, 12 7 S 16 17, 20 17" />
              <circle cx="4" cy="17" r="2" />
              <circle cx="20" cy="17" r="2" stroke="var(--accent-2)" />
            </svg>
          </div>
        </div>

        <div style={{ flex: 1, padding: '0 24px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.16em', color: 'var(--accent)' }}>
              {step === 'email' && 'STEP 1 / 2 · SIGN IN'}
              {step === 'otp' && 'STEP 2 / 2 · VERIFY'}
              {step === 'details' && 'ALMOST THERE · NEW ACCOUNT'}
            </span>
            <h1 style={{ margin: 0, fontSize: 32, lineHeight: 1.08, fontWeight: 600, letterSpacing: '-0.03em', whiteSpace: 'pre-line' }}>
              {step === 'email' && 'Ride together.\nPay less.'}
              {step === 'otp' && 'Enter the code'}
              {step === 'details' && 'Tell us about you'}
            </h1>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-muted)' }}>
              {step === 'email' &&
                'Sign in with your email. We send a one-time code — no password to remember.'}
              {step === 'otp' && `We sent a 6-digit code to ${email}.`}
              {step === 'details' && "This email doesn't have an account yet — we'll create one."}
            </p>
          </div>

          {error && (
            <p
              role="alert"
              style={{
                margin: 0,
                padding: '10px 14px',
                borderRadius: 12,
                background: 'var(--surface-2)',
                border: '1px solid var(--warning-border)',
                color: 'var(--warning)',
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              {error}
            </p>
          )}

          {step === 'email' && (
            <form
              className="sr-rise"
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
              onSubmit={(event) => {
                event.preventDefault();
                if (emailValid && !loading) void handleSendCode();
              }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.14em', color: 'var(--text-muted)' }}>
                  EMAIL
                </span>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    height: 56,
                    padding: '0 16px',
                    borderRadius: 'var(--radius-control)',
                    background: 'var(--surface-2)',
                    border: `1px solid ${emailValid ? 'var(--accent)' : 'var(--border)'}`,
                    transition: 'all .25s',
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="5" width="18" height="14" rx="3" />
                    <path d="m3 7 9 6 9-6" />
                  </svg>
                  <input
                    className="sr-login-input"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: 0,
                      outline: 'none',
                      color: 'var(--text)',
                      font: "500 16px var(--font-ui)",
                      padding: 0,
                    }}
                  />
                </span>
              </label>
              <button
                type="submit"
                disabled={!emailValid || loading}
                style={{
                  height: 58,
                  borderRadius: 'var(--radius-control)',
                  border: 0,
                  cursor: emailValid && !loading ? 'pointer' : 'not-allowed',
                  background: emailValid ? 'var(--accent)' : 'var(--surface-3)',
                  color: emailValid ? 'var(--accent-on)' : 'var(--text-muted)',
                  font: "700 17px var(--font-ui)",
                  boxShadow: emailValid ? 'var(--accent-glow)' : 'none',
                }}
              >
                {loading ? 'Sending…' : 'Send login code'}
              </button>
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)', textAlign: 'center' }}>
                No passwords. New here? We'll set up your account after you verify.
              </p>
            </form>
          )}

          {step === 'otp' && (
            <form
              className="sr-rise"
              style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
              onSubmit={(event) => {
                event.preventDefault();
                if (otpValid && !loading) void submitVerify();
              }}
            >
              <label style={{ position: 'relative', display: 'flex', gap: 8, cursor: 'text' }}>
                <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                  6-digit code
                </span>
                {Array.from({ length: 6 }, (_, i) => {
                  const filled = i < otp.length;
                  const active = i === otp.length;
                  const border = active ? 'var(--accent)' : filled ? 'var(--text-2)' : 'var(--border)';
                  return (
                    <span
                      key={i}
                      style={{
                        flex: 1,
                        height: 62,
                        borderRadius: 14,
                        background: 'var(--surface-2)',
                        border: `1px solid ${border}`,
                        boxShadow: active ? '0 0 16px rgba(46,230,246,.25)' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        font: "600 26px var(--font-mono)",
                        color: 'var(--text)',
                        transition: 'all .2s',
                      }}
                    >
                      {filled ? otp[i] : ''}
                      {active && <span className="sr-caret" style={{ width: 2, height: 26, background: 'var(--accent)' }} />}
                    </span>
                  );
                })}
                <input
                  ref={otpInputRef}
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoFocus
                  style={{ position: 'absolute', inset: 0, opacity: 0, fontSize: 16 }}
                />
              </label>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
                <span>
                  Expires in <span style={{ color: 'var(--text)' }}>{mm}:{ss}</span>
                </span>
                <span>5 attempts max</span>
              </div>

              <button
                type="submit"
                disabled={!otpValid || loading}
                style={{
                  height: 58,
                  borderRadius: 'var(--radius-control)',
                  border: 0,
                  cursor: otpValid && !loading ? 'pointer' : 'not-allowed',
                  background: otpValid ? 'var(--accent)' : 'var(--surface-3)',
                  color: otpValid ? 'var(--accent-on)' : 'var(--text-muted)',
                  font: "700 17px var(--font-ui)",
                  boxShadow: otpValid ? 'var(--accent-glow)' : 'none',
                }}
              >
                {loading ? 'Verifying…' : 'Verify & continue'}
              </button>

              <div style={{ display: 'flex', justifyContent: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
                <span>Didn't get it?</span>
                <button
                  type="button"
                  onClick={() => void handleResend()}
                  disabled={cooldown > 0 || loading}
                  style={{
                    background: 'none',
                    border: 0,
                    padding: 0,
                    cursor: cooldown > 0 || loading ? 'default' : 'pointer',
                    font: "600 13px var(--font-ui)",
                    color: cooldown > 0 ? 'var(--text-muted)' : 'var(--accent)',
                  }}
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStep('email');
                  setOtp('');
                  setError(null);
                }}
                style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--text-muted)', font: "500 13px var(--font-ui)", minHeight: 44 }}
              >
                Use a different email
              </button>
            </form>
          )}

          {step === 'details' && (
            <form
              className="sr-rise"
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
              onSubmit={(event) => {
                event.preventDefault();
                if (detailsValid && !loading) void submitVerify({ name: name.trim(), phone: phone.trim() });
              }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.14em', color: 'var(--text-muted)' }}>
                  FULL NAME
                </span>
                <input
                  className="sr-login-input"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                  style={{
                    height: 56,
                    padding: '0 16px',
                    borderRadius: 'var(--radius-control)',
                    background: 'var(--surface-2)',
                    border: `1px solid ${name.trim() ? 'var(--accent)' : 'var(--border)'}`,
                    color: 'var(--text)',
                    font: "500 16px var(--font-ui)",
                    outline: 'none',
                  }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.14em', color: 'var(--text-muted)' }}>
                  PHONE
                </span>
                <input
                  className="sr-login-input"
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="Your phone number"
                  autoComplete="tel"
                  style={{
                    height: 56,
                    padding: '0 16px',
                    borderRadius: 'var(--radius-control)',
                    background: 'var(--surface-2)',
                    border: `1px solid ${phone.trim() ? 'var(--accent)' : 'var(--border)'}`,
                    color: 'var(--text)',
                    font: "500 16px var(--font-ui)",
                    outline: 'none',
                  }}
                />
              </label>
              <button
                type="submit"
                disabled={!detailsValid || loading}
                style={{
                  height: 58,
                  borderRadius: 'var(--radius-control)',
                  border: 0,
                  cursor: detailsValid && !loading ? 'pointer' : 'not-allowed',
                  background: detailsValid ? 'var(--accent)' : 'var(--surface-3)',
                  color: detailsValid ? 'var(--accent-on)' : 'var(--text-muted)',
                  font: "700 17px var(--font-ui)",
                  boxShadow: detailsValid ? 'var(--accent-glow)' : 'none',
                }}
              >
                {loading ? 'Creating account…' : 'Create account & continue'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

import { Mail } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import { roleHomePath, InvalidSessionError } from '../auth/roles';
import { ApiError } from '../api/client';
import { Button } from '../components/ui/Button';
import { cn } from '../lib/cn';
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
    <div className="flex min-h-dvh flex-col items-center bg-canvas">
      <div className="flex w-full max-w-md flex-1 flex-col">
        <div className="relative flex h-[300px] items-center justify-center">
          <div className="sr-orbit2 absolute size-[300px] rounded-full border border-dashed border-border-strong">
            <span className="absolute left-1/2 -top-[5px] size-2.5 rounded-sm bg-violet-500 shadow-[0_0_14px_rgba(139,92,246,0.7)]" />
          </div>
          <div className="sr-orbit1 absolute size-[210px] rounded-full border border-border-subtle">
            <span className="absolute bottom-[18px] left-[14px] size-2.5 rounded-full bg-accent-700 shadow-[0_0_14px_rgba(15,118,110,0.7)]" />
            <span className="absolute right-1.5 top-[30px] size-1.5 rounded-full bg-ink opacity-70" />
          </div>
          <div className="relative flex size-[104px] items-center justify-center rounded-[32px] border border-accent-700 bg-surface shadow-[0_0_50px_rgba(15,118,110,0.2),inset_0_0_26px_rgba(15,118,110,0.12)]">
            <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-accent-700" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 17 C 8 17, 8 7, 12 7 S 16 17, 20 17" />
              <circle cx="4" cy="17" r="2" />
              <circle cx="20" cy="17" r="2" className="text-violet-500" stroke="currentColor" />
            </svg>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-5 px-6 pb-8">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-xs tracking-[0.16em] text-accent-700">
              {step === 'email' && 'STEP 1 / 2 · SIGN IN'}
              {step === 'otp' && 'STEP 2 / 2 · VERIFY'}
              {step === 'details' && 'ALMOST THERE · NEW ACCOUNT'}
            </span>
            <h1 className="whitespace-pre-line text-[32px] font-semibold leading-[1.08] tracking-tight text-ink">
              {step === 'email' && 'Ride together.\nPay less.'}
              {step === 'otp' && 'Enter the code'}
              {step === 'details' && 'Tell us about you'}
            </h1>
            <p className="text-sm leading-relaxed text-ink-muted">
              {step === 'email' &&
                'Sign in with your email. We send a one-time code — no password to remember.'}
              {step === 'otp' && `We sent a 6-digit code to ${email}.`}
              {step === 'details' && "This email doesn't have an account yet — we'll create one."}
            </p>
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm leading-relaxed text-amber-700">
              {error}
            </p>
          )}

          {step === 'email' && (
            <form
              className="sr-rise flex flex-col gap-3.5"
              onSubmit={(event) => {
                event.preventDefault();
                if (emailValid && !loading) void handleSendCode();
              }}
            >
              <label className="flex flex-col gap-2">
                <span className="font-mono text-[10px] tracking-wider text-ink-muted">EMAIL</span>
                <span
                  className={cn(
                    'flex h-14 items-center gap-3 rounded-xl border px-4 transition-colors',
                    emailValid ? 'border-accent-700' : 'border-border-strong',
                  )}
                >
                  <Mail className="size-[18px] text-ink-faint" aria-hidden />
                  <input
                    className="sr-login-input flex-1 border-0 bg-transparent text-base font-medium text-ink outline-none"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </span>
              </label>
              <Button type="submit" size="lg" className="h-14 text-base" disabled={!emailValid} loading={loading}>
                Send login code
              </Button>
              <p className="text-center text-xs leading-relaxed text-ink-muted">
                No passwords. New here? We'll set up your account after you verify.
              </p>
            </form>
          )}

          {step === 'otp' && (
            <form
              className="sr-rise flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (otpValid && !loading) void submitVerify();
              }}
            >
              <label className="relative flex cursor-text gap-2">
                <span className="sr-only">6-digit code</span>
                {Array.from({ length: 6 }, (_, i) => {
                  const filled = i < otp.length;
                  const active = i === otp.length;
                  return (
                    <span
                      key={i}
                      className={cn(
                        'flex h-[62px] flex-1 items-center justify-center rounded-xl border font-mono text-[26px] font-semibold text-ink transition-colors',
                        active ? 'border-accent-700' : filled ? 'border-ink-faint' : 'border-border-strong',
                        active && 'shadow-[0_0_16px_rgba(15,118,110,0.25)]',
                      )}
                    >
                      {filled ? otp[i] : ''}
                      {active && <span className="sr-caret h-[26px] w-0.5 bg-accent-700" />}
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
                  className="absolute inset-0 text-base opacity-0"
                />
              </label>

              <div className="flex justify-between font-mono text-xs text-ink-muted">
                <span>
                  Expires in <span className="text-ink">{mm}:{ss}</span>
                </span>
                <span>5 attempts max</span>
              </div>

              <Button type="submit" size="lg" className="h-14 text-base" disabled={!otpValid} loading={loading}>
                Verify & continue
              </Button>

              <div className="flex justify-center gap-1.5 text-sm text-ink-muted">
                <span>Didn't get it?</span>
                <button
                  type="button"
                  onClick={() => void handleResend()}
                  disabled={cooldown > 0 || loading}
                  className={cn(
                    'border-0 bg-transparent p-0 text-sm font-semibold',
                    cooldown > 0 || loading ? 'cursor-default text-ink-muted' : 'cursor-pointer text-accent-700',
                  )}
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
                className="min-h-11 border-0 bg-transparent text-sm text-ink-muted"
              >
                Use a different email
              </button>
            </form>
          )}

          {step === 'details' && (
            <form
              className="sr-rise flex flex-col gap-3.5"
              onSubmit={(event) => {
                event.preventDefault();
                if (detailsValid && !loading) void submitVerify({ name: name.trim(), phone: phone.trim() });
              }}
            >
              <label className="flex flex-col gap-2">
                <span className="font-mono text-[10px] tracking-wider text-ink-muted">FULL NAME</span>
                <input
                  className={cn(
                    'sr-login-input h-14 rounded-xl border bg-surface px-4 text-base font-medium text-ink outline-none',
                    name.trim() ? 'border-accent-700' : 'border-border-strong',
                  )}
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="font-mono text-[10px] tracking-wider text-ink-muted">PHONE</span>
                <input
                  className={cn(
                    'sr-login-input h-14 rounded-xl border bg-surface px-4 text-base font-medium text-ink outline-none',
                    phone.trim() ? 'border-accent-700' : 'border-border-strong',
                  )}
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="Your phone number"
                  autoComplete="tel"
                />
              </label>
              <Button type="submit" size="lg" className="h-14 text-base" disabled={!detailsValid} loading={loading}>
                Create account & continue
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

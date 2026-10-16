import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import { withAuthRetry } from '../api/withAuthRetry';
import { getMe } from '../api/users';
import type { User } from '../api/auth';
import { submitDriverApplication } from '../api/driverApplication';
import type { DriverApplicationResult } from '../api/driverApplication';
import { ApiError } from '../api/client';

// Mirrors userRepository.markDriverApplicationPending's own WHERE clause
// (driverLicenseStatus null or REJECTED) plus the role check this screen's
// only entry point (AccountScreen) already applies — re-checked HERE,
// against a freshly fetched profile, because `session.user` is only ever
// refreshed on login/token-refresh (session.tsx's applySession), not on
// every GET /users/me read elsewhere; it can be stale relative to an
// admin decision made since. A direct navigation to this route (typed URL,
// back-button, stale bookmark) must never trust that staleness, or
// AccountScreen's own entry-point link.
function isEligible(profile: User): boolean {
  return profile.role === 'PASSENGER' && (profile.driverLicenseStatus === null || profile.driverLicenseStatus === 'REJECTED');
}

function ineligibilityMessage(profile: User): string {
  if (profile.role !== 'PASSENGER') {
    return "This isn't available for your account type.";
  }
  if (profile.driverLicenseStatus === 'PENDING') {
    return 'Your application is already submitted and awaiting review.';
  }
  if (profile.driverLicenseStatus === 'VERIFIED') {
    return "You're already an approved driver — there's nothing to apply for.";
  }
  return "This isn't available right now.";
}

// Mirrors src/middleware/uploadDocument.ts's own magic-byte allow-list and
// 5 MB multer limit exactly — a UX hint only, checked against the
// browser-reported `file.type`/`file.size`, which a renamed or crafted file
// can misreport. The backend's real check is on the file's actual bytes
// and is the only one that can ever be trusted; this just avoids an
// obviously-doomed upload and gives an earlier, clearer message.
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DriverApplicationScreen() {
  const session = useSession();
  const navigate = useNavigate();

  // The authoritative gate — fetched fresh on mount, never assumed from
  // `session.user` or from having been linked here by AccountScreen. The
  // form (below) must not render until this resolves, so the default
  // state here is "loading", not "eligible": a direct/stale navigation
  // must never flash the form before this settles.
  const [profile, setProfile] = useState<User | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<DriverApplicationResult | null>(null);
  // Synchronous guard, same reasoning as every other submit action in this
  // app: a rapid double-click could otherwise fire two overlapping uploads
  // before React re-renders with the button disabled.
  const submitInFlightRef = useRef(false);

  const fileTypeValid = !file || ACCEPTED_TYPES.includes(file.type);
  const fileSizeValid = !file || file.size <= MAX_FILE_SIZE_BYTES;
  const canSubmit = file !== null && fileTypeValid && fileSizeValid && !submitting;

  function loadProfile() {
    let cancelled = false;
    setProfileLoading(true);
    setProfileLoadError(null);

    withAuthRetry(session, (token) => getMe(token))
      .then((user) => {
        if (!cancelled) setProfile(user);
      })
      .catch((cause) => {
        if (!cancelled) {
          setProfileLoadError(cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.');
        }
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }

  useEffect(() => {
    const cancel = loadProfile();
    return cancel;
    // Mount-once: session's identity is stable per its own context memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFileChange(selected: File | null) {
    setFile(selected);
    setSubmitError(null);
  }

  async function handleSubmit() {
    // Defense in depth: the form that calls this is never rendered unless
    // `profile` is loaded and eligible (see the render below), but this
    // must never be the ONLY thing standing between a call and an upload
    // the backend would reject anyway.
    if (!file || !canSubmit || !profile || !isEligible(profile) || submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    setSubmitting(true);
    setSubmitError(null);

    try {
      // The ACTUAL returned status is what's shown below — never assumed
      // to be PENDING just because the request didn't throw.
      const submitted = await withAuthRetry(session, (token) => submitDriverApplication(file, token));
      setResult(submitted);
    } catch (cause) {
      setSubmitError(cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.');
    } finally {
      submitInFlightRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
      <div style={{ maxWidth: 440, margin: '0 auto', padding: '20px 16px 48px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            type="button"
            aria-label="Back to account"
            onClick={() => navigate('/account')}
            style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>Apply to drive</h1>
        </div>

        {result ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: 20,
              borderRadius: 22,
              background: 'var(--surface-1)', boxShadow: 'var(--card-shadow)',
              border: '1px solid var(--success-border)',
            }}
          >
            <span style={{ font: '700 16px var(--font-ui)' }}>Application submitted</span>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)' }}>
              Status: <strong style={{ color: 'var(--text)' }}>{result.status}</strong>. An admin will review your
              licence document; you'll see the outcome on your account page once it's decided.
            </p>
            <button
              type="button"
              onClick={() => navigate('/account')}
              style={{
                height: 48,
                borderRadius: 'var(--radius-control)',
                border: 0,
                background: 'var(--accent)',
                color: 'var(--accent-on)',
                font: '700 14px var(--font-ui)',
                cursor: 'pointer',
              }}
            >
              Back to account
            </button>
          </div>
        ) : profileLoading ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '48px 0' }}>Loading…</p>
        ) : profileLoadError ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--warning-border)' }}>
            <p style={{ margin: 0, color: 'var(--warning)', fontSize: 14 }}>{profileLoadError}</p>
            <button
              type="button"
              onClick={() => loadProfile()}
              style={{ height: 40, borderRadius: 'var(--radius-control)', border: '1px solid var(--border)', background: 'var(--surface-3)', color: 'var(--accent-2)', font: '600 13px var(--font-ui)', cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        ) : profile && isEligible(profile) ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              padding: 20,
              borderRadius: 22,
              background: 'var(--surface-1)', boxShadow: 'var(--card-shadow)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)' }}>
              Upload a photo or scan of your driving licence. Accepted: JPEG, PNG, or PDF, up to 5 MB.
            </p>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Licence document</span>
              <input
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                onChange={(event) => handleFileChange(event.target.files?.[0] ?? null)}
                style={{
                  padding: 10,
                  borderRadius: 'var(--radius-control)',
                  background: 'var(--surface-2)',
                  border: `1px solid ${file && (!fileTypeValid || !fileSizeValid) ? 'var(--warning-border)' : 'var(--border)'}`,
                  color: 'var(--text)',
                  font: '400 13px var(--font-ui)',
                }}
              />
              {file && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {file.name} · {formatFileSize(file.size)}
                </span>
              )}
              {file && !fileTypeValid && (
                <span style={{ fontSize: 11, color: 'var(--warning)' }}>
                  Only JPEG, PNG, or PDF files are accepted.
                </span>
              )}
              {file && fileTypeValid && !fileSizeValid && (
                <span style={{ fontSize: 11, color: 'var(--warning)' }}>
                  That file is larger than 5 MB.
                </span>
              )}
            </label>

            {submitError && (
              <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--warning)' }}>
                {submitError}
              </p>
            )}

            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => void handleSubmit()}
              style={{
                height: 50,
                borderRadius: 'var(--radius-control)',
                border: 0,
                background: canSubmit ? 'var(--accent)' : 'var(--surface-3)',
                color: canSubmit ? 'var(--accent-on)' : 'var(--text-muted)',
                font: '700 14px var(--font-ui)',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {submitting ? 'Submitting…' : 'Submit application'}
            </button>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              padding: 20,
              borderRadius: 22,
              background: 'var(--surface-1)', boxShadow: 'var(--card-shadow)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-2)' }}>
              {profile ? ineligibilityMessage(profile) : "This isn't available right now."}
            </p>
            <button
              type="button"
              onClick={() => navigate('/account')}
              style={{
                height: 48,
                borderRadius: 'var(--radius-control)',
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                color: 'var(--accent-2)',
                font: '600 14px var(--font-ui)',
                cursor: 'pointer',
              }}
            >
              Back to account
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

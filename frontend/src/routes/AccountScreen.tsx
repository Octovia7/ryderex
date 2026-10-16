import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import { withAuthRetry } from '../api/withAuthRetry';
import { getMe, updateMe } from '../api/users';
import type { UpdateProfileInput } from '../api/users';
import type { User } from '../api/auth';
import { ApiError } from '../api/client';

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(new Date(iso));
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

const inputStyle = {
  height: 52,
  padding: '0 16px',
  borderRadius: 'var(--radius-control)',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  font: '500 15px var(--font-ui)',
  outline: 'none',
  width: '100%',
} as const;

export function AccountScreen() {
  const session = useSession();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [profileImageUrl, setProfileImageUrl] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedJustNow, setSavedJustNow] = useState(false);
  // Synchronous guard, same reasoning as every other submit action in this
  // app: a rapid double-click could otherwise fire two overlapping PATCH
  // requests before React re-renders with the button disabled.
  const saveInFlightRef = useRef(false);

  // Tracks a failed <img> load so the render below can fall back to
  // initials declaratively — mutating the <img> element directly from
  // onError (hiding it) would leave an empty circle, since React only
  // evaluates the avatar ternary on render, not when the DOM mutates on its
  // own. Reset whenever the profile (re)loads, so a new profileImageUrl
  // gets its own chance to load.
  const [avatarFailed, setAvatarFailed] = useState(false);

  // Driver-access activation: the backend flips role PASSENGER -> DRIVER in
  // the database the moment an admin verifies the licence, but an
  // already-issued access token keeps its OLD role claim until a new one is
  // minted (authenticate.ts reads role straight off the JWT, never a fresh
  // DB row) — so `session.user.role` can lag `profile.driverLicenseStatus`
  // by as long as the access-token TTL. `activating`/`activationError` are
  // this component's own state for that one-time catch-up attempt;
  // `session.user.role` itself is never written here — only `refresh()`
  // (via `session.refreshAccessToken()`) is allowed to change it, and only
  // with the server's own real response.
  const [activating, setActivating] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  // Synchronous guard against overlapping refresh calls, same reasoning as
  // every other submit action in this app.
  const activationInFlightRef = useRef(false);
  // Set once the automatic effect below has fired for the CURRENT mismatch —
  // never reset automatically, so a re-render or a repeated profile load
  // (e.g. the "Try again" button, or a profile edit) never fires a second
  // automatic attempt. Only the manual retry button bypasses this (by
  // calling triggerActivation directly, not through the effect).
  const autoActivationTriedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function triggerActivation() {
    if (activationInFlightRef.current) return;
    activationInFlightRef.current = true;
    setActivating(true);
    setActivationError(null);

    try {
      // Resolves to the new access token on success, or null on failure
      // (session.tsx's refresh()) — it does NOT synchronously update
      // `session.user` in this closure; that happens via React state
      // (setUser inside applySession) and is only visible on a LATER
      // render reading a fresh useSession() call. Success/failure here is
      // judged by the render below (stillMismatched), never by reading
      // `session.user` again inside this function right after the await.
      const token = await session.refreshAccessToken();
      if (!mountedRef.current) return;
      if (!token) {
        setActivationError("Couldn't activate your driver access. Try again.");
      }
    } catch {
      if (mountedRef.current) {
        setActivationError("Couldn't activate your driver access. Try again.");
      }
    } finally {
      activationInFlightRef.current = false;
      if (mountedRef.current) setActivating(false);
    }
  }

  // The one automatic attempt. Depends on `profile` (so it re-evaluates
  // whenever a fresh profile load lands) and `session.user?.role` (so it
  // notices the mismatch actually clearing) — but `autoActivationTriedRef`
  // is what actually prevents more than one automatic call: once set, this
  // effect becomes a no-op for the rest of this component's lifetime,
  // however many times it re-runs.
  useEffect(() => {
    if (!profile) return;
    if (profile.driverLicenseStatus !== 'VERIFIED') return;
    if (session.user?.role === 'DRIVER') return;
    if (autoActivationTriedRef.current) return;
    autoActivationTriedRef.current = true;
    void triggerActivation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, session.user?.role]);

  function applyProfile(user: User) {
    setProfile(user);
    setName(user.name);
    setPhone(user.phone);
    setEmail(user.email);
    setProfileImageUrl(user.profileImageUrl ?? '');
    setAvatarFailed(false);
  }

  function loadProfile() {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    withAuthRetry(session, (token) => getMe(token))
      .then((user) => {
        if (!cancelled) applyProfile(user);
      })
      .catch((cause) => {
        if (!cancelled) {
          setLoadError(cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
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

  // Only the fields that actually changed are sent — never the unchanged
  // three alongside one real edit, and never profileImageUrl as an empty
  // string (the backend's schema requires a valid URL if the key is present
  // at all; there's no way to clear it back to null through this endpoint,
  // only to replace it with a different URL).
  function buildChanges(): UpdateProfileInput | null {
    if (!profile) return null;
    const changes: UpdateProfileInput = {};

    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim();
    const trimmedImage = profileImageUrl.trim();

    if (trimmedName && trimmedName !== profile.name) changes.name = trimmedName;
    if (trimmedPhone && trimmedPhone !== profile.phone) changes.phone = trimmedPhone;
    if (trimmedEmail && trimmedEmail !== profile.email) changes.email = trimmedEmail;
    if (trimmedImage && trimmedImage !== (profile.profileImageUrl ?? '')) {
      changes.profileImageUrl = trimmedImage;
    }

    return Object.keys(changes).length > 0 ? changes : null;
  }

  const changes = buildChanges();
  const imageUrlProvided = profileImageUrl.trim().length > 0;
  const imageUrlValid = !imageUrlProvided || isValidUrl(profileImageUrl.trim());
  const canSave = changes !== null && imageUrlValid && !saving;

  // Recomputed fresh on every render from the CURRENT session.user, never
  // from a value captured before an await — this is what actually decides
  // whether the activation banner/error shows, not anything set inside
  // triggerActivation itself.
  const driverAccessMismatched =
    profile?.driverLicenseStatus === 'VERIFIED' && session.user?.role !== 'DRIVER';
  const showActivating = activating || (driverAccessMismatched && !autoActivationTriedRef.current);

  async function handleSave() {
    if (!canSave || saveInFlightRef.current) return;
    const toSend = buildChanges();
    if (!toSend) return;

    saveInFlightRef.current = true;
    setSaving(true);
    setSaveError(null);
    setSavedJustNow(false);

    try {
      const updated = await withAuthRetry(session, (token) => updateMe(toSend, token));
      applyProfile(updated);
      setSavedJustNow(true);
    } catch (cause) {
      setSaveError(cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.');
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
      <div style={{ maxWidth: 390, margin: '0 auto', padding: '20px 16px 48px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            type="button"
            aria-label="Back"
            onClick={() => navigate(-1)}
            style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>Account</h1>
        </div>

        {loading && (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '48px 0' }}>Loading your account…</p>
        )}

        {!loading && loadError && !profile && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--warning-border)' }}>
            <p style={{ margin: 0, color: 'var(--warning)', fontSize: 14 }}>{loadError}</p>
            <button
              type="button"
              onClick={() => loadProfile()}
              style={{ height: 40, borderRadius: 'var(--radius-control)', border: '1px solid var(--border)', background: 'var(--surface-3)', color: 'var(--accent-2)', font: '600 13px var(--font-ui)', cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        )}

        {!loading && profile && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  flexShrink: 0,
                  overflow: 'hidden',
                  background: 'var(--surface-3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  font: '600 18px var(--font-ui)',
                }}
              >
                {profile.profileImageUrl && !avatarFailed ? (
                  <img
                    src={profile.profileImageUrl}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  profile.name.slice(0, 2).toUpperCase()
                )}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 17, fontWeight: 600 }}>{profile.name}</span>
                <span
                  style={{
                    alignSelf: 'flex-start',
                    borderRadius: 'var(--radius-chip)',
                    border: '1px solid var(--border)',
                    background: 'var(--surface-3)',
                    color: 'var(--accent)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    letterSpacing: '.08em',
                    padding: '3px 9px',
                  }}
                >
                  {profile.role}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
              <span>Member since</span>
              <span>{formatDate(profile.createdAt)}</span>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                padding: 20,
                borderRadius: 22,
                background: 'var(--surface-1)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.14em', color: 'var(--text-muted)' }}>
                EDIT PROFILE
              </span>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Name</span>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Phone</span>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Email</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Profile image URL</span>
                <input
                  type="text"
                  value={profileImageUrl}
                  onChange={(e) => setProfileImageUrl(e.target.value)}
                  placeholder="https://…"
                  style={{
                    ...inputStyle,
                    border: `1px solid ${imageUrlValid ? 'var(--border)' : 'var(--warning-border)'}`,
                  }}
                />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  There's no way to remove a photo once set — only replace it with a different URL.
                </span>
                {!imageUrlValid && (
                  <span style={{ fontSize: 11, color: 'var(--warning)' }}>That doesn't look like a valid URL.</span>
                )}
              </label>

              {saveError && (
                <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--warning)' }}>
                  {saveError}
                </p>
              )}
              {savedJustNow && !saveError && (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--accent)' }}>Saved.</p>
              )}

              <button
                type="button"
                disabled={!canSave}
                onClick={() => void handleSave()}
                style={{
                  height: 50,
                  borderRadius: 'var(--radius-control)',
                  border: 0,
                  background: canSave ? 'var(--accent)' : 'var(--surface-3)',
                  color: canSave ? 'var(--accent-on)' : 'var(--text-muted)',
                  font: '700 14px var(--font-ui)',
                  cursor: canSave ? 'pointer' : 'not-allowed',
                }}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                padding: 20,
                borderRadius: 22,
                background: 'var(--surface-1)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.14em', color: 'var(--text-muted)' }}>
                REPUTATION
              </span>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--text-2)' }}>
                <span>As a passenger</span>
                <span style={{ color: 'var(--star)', fontFamily: 'var(--font-mono)' }}>
                  {profile.passengerRatingAverage == null
                    ? 'Not yet rated'
                    : `★ ${profile.passengerRatingAverage.toFixed(1)} (${profile.passengerRatingCount})`}
                </span>
              </div>
              {profile.role === 'DRIVER' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--text-2)' }}>
                  <span>As a driver</span>
                  <span style={{ color: 'var(--star)', fontFamily: 'var(--font-mono)' }}>
                    {profile.driverRatingAverage == null
                      ? 'Not yet rated'
                      : `★ ${profile.driverRatingAverage.toFixed(1)} (${profile.driverRatingCount})`}
                  </span>
                </div>
              )}
            </div>

            {(profile.driverLicenseStatus !== null || profile.role === 'PASSENGER') && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  padding: 16,
                  borderRadius: 18,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: 13,
                }}
              >
                {profile.driverLicenseStatus && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-2)' }}>Driver licence</span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}>
                        {profile.driverLicenseStatus}
                      </span>
                    </div>
                    {profile.driverLicenseStatus === 'REJECTED' && profile.driverLicenseRejectionReason && (
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                        {profile.driverLicenseRejectionReason}
                      </span>
                    )}
                  </div>
                )}

                {showActivating && (
                  <p role="status" style={{ margin: 0, fontSize: 12, color: 'var(--accent)' }}>
                    Your licence is verified. Activating your driver access…
                  </p>
                )}

                {!showActivating && autoActivationTriedRef.current && driverAccessMismatched && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--warning)' }}>
                      {activationError ?? "Your driver access hasn't activated yet."}
                    </p>
                    <button
                      type="button"
                      onClick={() => void triggerActivation()}
                      style={{
                        height: 40,
                        borderRadius: 'var(--radius-control)',
                        border: '1px solid var(--border)',
                        background: 'var(--surface-3)',
                        color: 'var(--accent-2)',
                        font: '600 13px var(--font-ui)',
                        cursor: 'pointer',
                      }}
                    >
                      Try again
                    </button>
                  </div>
                )}

                {/* Never shown for PENDING (already submitted, awaiting
                    review) or VERIFIED (already a driver) — only when there
                    is genuinely nothing pending: never applied, or the last
                    application was rejected. */}
                {profile.role === 'PASSENGER' &&
                  (profile.driverLicenseStatus === null || profile.driverLicenseStatus === 'REJECTED') && (
                    <>
                      {!profile.driverLicenseStatus && (
                        <span style={{ color: 'var(--text-2)' }}>Want to drive on SaathiRide?</span>
                      )}
                      <button
                        type="button"
                        onClick={() => navigate('/account/driver-application')}
                        style={{
                          height: 44,
                          borderRadius: 'var(--radius-control)',
                          border: '1px solid var(--border)',
                          background: 'var(--surface-3)',
                          color: 'var(--accent-2)',
                          font: '600 13px var(--font-ui)',
                          cursor: 'pointer',
                        }}
                      >
                        {profile.driverLicenseStatus === 'REJECTED' ? 'Resubmit application' : 'Apply to become a driver'}
                      </button>
                    </>
                  )}
              </div>
            )}

            <button
              type="button"
              onClick={() => void session.logout()}
              style={{
                height: 44,
                borderRadius: 'var(--radius-control)',
                border: '1px solid var(--border)',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                font: '600 13px var(--font-ui)',
                cursor: 'pointer',
              }}
            >
              Log out
            </button>
          </>
        )}
      </div>
    </div>
  );
}

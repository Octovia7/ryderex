import { ChevronLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import { withAuthRetry } from '../api/withAuthRetry';
import { getMe, updateMe } from '../api/users';
import type { UpdateProfileInput } from '../api/users';
import type { User } from '../api/auth';
import { ApiError } from '../api/client';
import { Card, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Field, TextInput } from '../components/ui/Input';

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
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate(-1)}
          className="flex size-10 items-center justify-center rounded-lg border border-border-strong bg-surface text-ink-muted transition-colors hover:bg-slate-50"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Account</h1>
      </div>

      {loading && <p className="py-12 text-center text-sm text-ink-muted">Loading your account…</p>}

      {!loading && loadError && !profile && (
        <Card className="border-red-200 bg-red-50">
          <CardBody className="flex flex-col gap-3">
            <p className="text-sm text-red-700">{loadError}</p>
            <Button variant="secondary" size="sm" className="w-fit" onClick={() => loadProfile()}>
              Try again
            </Button>
          </CardBody>
        </Card>
      )}

      {!loading && profile && (
        <>
          <div className="flex items-center gap-3.5">
            <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-100 text-base font-semibold text-accent-800">
              {profile.profileImageUrl && !avatarFailed ? (
                <img
                  src={profile.profileImageUrl}
                  alt=""
                  className="size-full object-cover"
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                profile.name.slice(0, 2).toUpperCase()
              )}
            </span>
            <div className="flex flex-col gap-1">
              <span className="text-lg font-semibold text-ink">{profile.name}</span>
              <span className="w-fit rounded-full border border-border-subtle bg-slate-50 px-2.5 py-0.5 font-mono text-[10px] tracking-wider text-accent-700">
                {profile.role}
              </span>
            </div>
          </div>

          <div className="flex justify-between text-xs text-ink-muted">
            <span>Member since</span>
            <span>{formatDate(profile.createdAt)}</span>
          </div>

          <Card className="p-5">
            <div className="flex flex-col gap-4">
              <span className="font-mono text-[10px] tracking-wider text-ink-muted">EDIT PROFILE</span>

              <Field label="Name">
                {({ id }) => (
                  <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} />
                )}
              </Field>

              <Field label="Phone">
                {({ id }) => (
                  <TextInput id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
                )}
              </Field>

              <Field label="Email">
                {({ id }) => (
                  <TextInput id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                )}
              </Field>

              <Field
                label="Profile image URL"
                hint="There's no way to remove a photo once set — only replace it with a different URL."
                error={!imageUrlValid ? "That doesn't look like a valid URL." : undefined}
              >
                {({ id }) => (
                  <TextInput
                    id={id}
                    value={profileImageUrl}
                    onChange={(e) => setProfileImageUrl(e.target.value)}
                    placeholder="https://…"
                    invalid={!imageUrlValid}
                  />
                )}
              </Field>

              {saveError && <p className="text-xs text-red-600">{saveError}</p>}
              {savedJustNow && !saveError && <p className="text-xs text-accent-700">Saved.</p>}

              <Button disabled={!canSave} loading={saving} onClick={() => void handleSave()}>
                Save changes
              </Button>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex flex-col gap-3">
              <span className="font-mono text-[10px] tracking-wider text-ink-muted">REPUTATION</span>
              <div className="flex justify-between text-sm text-ink">
                <span>As a passenger</span>
                <span className="font-mono text-amber-600">
                  {profile.passengerRatingAverage == null
                    ? 'Not yet rated'
                    : `★ ${profile.passengerRatingAverage.toFixed(1)} (${profile.passengerRatingCount})`}
                </span>
              </div>
              {profile.role === 'DRIVER' && (
                <div className="flex justify-between text-sm text-ink">
                  <span>As a driver</span>
                  <span className="font-mono text-amber-600">
                    {profile.driverRatingAverage == null
                      ? 'Not yet rated'
                      : `★ ${profile.driverRatingAverage.toFixed(1)} (${profile.driverRatingCount})`}
                  </span>
                </div>
              )}
            </div>
          </Card>

          {(profile.driverLicenseStatus !== null || profile.role === 'PASSENGER') && (
            <Card className="bg-slate-50 p-4 text-sm">
              <div className="flex flex-col gap-2.5">
                {profile.driverLicenseStatus && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between">
                      <span className="text-ink-muted">Driver licence</span>
                      <span className="font-mono text-xs text-ink">{profile.driverLicenseStatus}</span>
                    </div>
                    {profile.driverLicenseStatus === 'REJECTED' && profile.driverLicenseRejectionReason && (
                      <span className="text-xs text-ink-muted">{profile.driverLicenseRejectionReason}</span>
                    )}
                  </div>
                )}

                {showActivating && (
                  <p role="status" className="text-xs text-accent-700">
                    Your licence is verified. Activating your driver access…
                  </p>
                )}

                {!showActivating && autoActivationTriedRef.current && driverAccessMismatched && (
                  <div className="flex flex-col gap-2">
                    <p role="alert" className="text-xs text-red-600">
                      {activationError ?? "Your driver access hasn't activated yet."}
                    </p>
                    <Button variant="secondary" size="sm" className="w-fit" onClick={() => void triggerActivation()}>
                      Try again
                    </Button>
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
                        <span className="text-ink-muted">Want to drive on Ryderex?</span>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        className="w-fit"
                        onClick={() => navigate('/account/driver-application')}
                      >
                        {profile.driverLicenseStatus === 'REJECTED' ? 'Resubmit application' : 'Apply to become a driver'}
                      </Button>
                    </>
                  )}
              </div>
            </Card>
          )}

          <Button variant="secondary" onClick={() => void session.logout()}>
            Log out
          </Button>
        </>
      )}
    </div>
  );
}

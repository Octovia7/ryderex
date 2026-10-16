import { ChevronLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import { withAuthRetry } from '../api/withAuthRetry';
import { getMe } from '../api/users';
import type { User } from '../api/auth';
import { submitDriverApplication } from '../api/driverApplication';
import type { DriverApplicationResult } from '../api/driverApplication';
import { ApiError } from '../api/client';
import { Card, CardBody } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { FileUpload } from '../components/ui/FileUpload';

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
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Back to account"
          onClick={() => navigate('/account')}
          className="flex size-10 items-center justify-center rounded-lg border border-border-strong bg-surface text-ink-muted transition-colors hover:bg-slate-50"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Apply to drive</h1>
      </div>

      {result ? (
        <Card className="border-emerald-200 p-5">
          <div className="flex flex-col gap-2.5">
            <span className="text-base font-bold text-ink">Application submitted</span>
            <p className="text-sm text-ink-muted">
              Status: <strong className="text-ink">{result.status}</strong>. An admin will review your licence
              document; you'll see the outcome on your account page once it's decided.
            </p>
            <Button onClick={() => navigate('/account')}>Back to account</Button>
          </div>
        </Card>
      ) : profileLoading ? (
        <p className="py-12 text-center text-sm text-ink-muted">Loading…</p>
      ) : profileLoadError ? (
        <Card className="border-red-200 bg-red-50">
          <CardBody className="flex flex-col gap-3">
            <p className="text-sm text-red-700">{profileLoadError}</p>
            <Button variant="secondary" size="sm" className="w-fit" onClick={() => loadProfile()}>
              Try again
            </Button>
          </CardBody>
        </Card>
      ) : profile && isEligible(profile) ? (
        <Card className="p-5">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-muted">
              Upload a photo or scan of your driving licence. Accepted: JPEG, PNG, or PDF, up to 5 MB.
            </p>

            <FileUpload
              label="Licence document"
              value={file}
              onChange={handleFileChange}
              disabled={submitting}
            />

            {submitError && <p className="text-xs text-red-600">{submitError}</p>}

            <Button disabled={!canSubmit} loading={submitting} onClick={() => void handleSubmit()}>
              Submit application
            </Button>
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-muted">
              {profile ? ineligibilityMessage(profile) : "This isn't available right now."}
            </p>
            <Button variant="secondary" onClick={() => navigate('/account')}>
              Back to account
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

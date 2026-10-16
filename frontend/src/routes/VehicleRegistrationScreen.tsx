import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../auth/session';
import { withAuthRetry } from '../api/withAuthRetry';
import {
  listVehicles,
  createVehicle,
  uploadVehicleDocument,
  VEHICLE_TYPES,
  VEHICLE_DOCUMENT_TYPES,
} from '../api/vehicles';
import type { Vehicle, VehicleType, VehicleDocumentType } from '../api/vehicles';
import { ApiError } from '../api/client';

// Mirrors src/middleware/uploadDocument.ts's own magic-byte allow-list and
// 5 MB multer limit exactly — the same UX-only check already used for the
// driver-licence upload (DriverApplicationScreen.tsx). The backend's real
// check is on the file's actual bytes; this just avoids an obviously-doomed
// upload and gives an earlier, clearer message.
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const DOCUMENT_LABELS: Record<VehicleDocumentType, string> = {
  RC: 'Registration certificate (RC)',
  INSURANCE: 'Insurance',
  POLLUTION: 'Pollution certificate',
};

function formatFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface DocumentUploadRowProps {
  vehicleId: string;
  documentType: VehicleDocumentType;
  uploadedCount: number;
  onUploaded: () => void;
}

// One independent upload slot per document type — each has its own file
// selection, in-flight guard, and error state, so uploading RC failing
// never affects the INSURANCE row sitting right below it.
function DocumentUploadRow({ vehicleId, documentType, uploadedCount, onUploaded }: DocumentUploadRowProps) {
  const session = useSession();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Synchronous guard, same reasoning as every other submit action in this
  // app: a rapid double-click could otherwise fire two overlapping uploads
  // before React re-renders with the button disabled.
  const uploadInFlightRef = useRef(false);

  const fileTypeValid = !file || ACCEPTED_TYPES.includes(file.type);
  const fileSizeValid = !file || file.size <= MAX_FILE_SIZE_BYTES;
  const canUpload = file !== null && fileTypeValid && fileSizeValid && !uploading;

  async function handleUpload() {
    if (!file || !canUpload || uploadInFlightRef.current) return;
    uploadInFlightRef.current = true;
    setUploading(true);
    setUploadError(null);

    try {
      await withAuthRetry(session, (token) => uploadVehicleDocument(vehicleId, documentType, file, token));
      setFile(null);
      // Refresh from the authoritative source (the parent's listVehicles()
      // call) rather than assuming this document now appears — mirrors the
      // driver-licence flow's "never mark something as submitted
      // optimistically" discipline.
      onUploaded();
    } catch (cause) {
      setUploadError(cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.');
    } finally {
      uploadInFlightRef.current = false;
      setUploading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14, borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{DOCUMENT_LABELS[documentType]}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {uploadedCount > 0 ? `${uploadedCount} uploaded` : 'None uploaded yet'}
        </span>
      </div>

      <input
        type="file"
        aria-label={DOCUMENT_LABELS[documentType]}
        accept="image/jpeg,image/png,application/pdf"
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          setUploadError(null);
        }}
        style={{
          padding: 8,
          borderRadius: 'var(--radius-control)',
          background: 'var(--surface-1)',
          border: `1px solid ${file && (!fileTypeValid || !fileSizeValid) ? 'var(--warning-border)' : 'var(--border)'}`,
          color: 'var(--text)',
          font: '400 12px var(--font-ui)',
        }}
      />
      {file && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {file.name} · {formatFileSize(file.size)}
        </span>
      )}
      {file && !fileTypeValid && (
        <span style={{ fontSize: 11, color: 'var(--warning)' }}>Only JPEG, PNG, or PDF files are accepted.</span>
      )}
      {file && fileTypeValid && !fileSizeValid && (
        <span style={{ fontSize: 11, color: 'var(--warning)' }}>That file is larger than 5 MB.</span>
      )}
      {uploadError && (
        <p role="alert" style={{ margin: 0, fontSize: 11, color: 'var(--warning)' }}>
          {uploadError}
        </p>
      )}

      <button
        type="button"
        disabled={!canUpload}
        onClick={() => void handleUpload()}
        style={{
          height: 40,
          borderRadius: 'var(--radius-control)',
          border: 0,
          background: canUpload ? 'var(--accent)' : 'var(--surface-3)',
          color: canUpload ? 'var(--accent-on)' : 'var(--text-muted)',
          font: '700 12px var(--font-ui)',
          cursor: canUpload ? 'pointer' : 'not-allowed',
        }}
      >
        {uploading ? 'Uploading…' : 'Upload'}
      </button>
    </div>
  );
}

const inputStyle = {
  height: 50,
  padding: '0 14px',
  borderRadius: 'var(--radius-control)',
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  font: '500 15px var(--font-ui)',
  outline: 'none',
  width: '100%',
} as const;

export function VehicleRegistrationScreen() {
  const session = useSession();
  const navigate = useNavigate();

  // Every vehicle the driver owns, any status — GET /vehicles already
  // returns all of them; this screen now shows all of them too, instead of
  // only the first.
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Manual toggle for "Register another vehicle" — only consulted once at
  // least one vehicle already exists (see `showRegisterForm` below); with
  // zero vehicles the form is always shown regardless of this value, so a
  // first-time driver sees exactly the same experience as before.
  const [registerFormOpen, setRegisterFormOpen] = useState(false);

  const [registrationNumber, setRegistrationNumber] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('HATCHBACK');
  const [seatCapacityInput, setSeatCapacityInput] = useState('4');
  const [model, setModel] = useState('');
  const [isAc, setIsAc] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Synchronous guard, same reasoning as every other submit action in this
  // app: a rapid double-click could otherwise fire two overlapping POSTs
  // before React re-renders with the button disabled.
  const createInFlightRef = useRef(false);

  function loadVehicles() {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    withAuthRetry(session, (token) => listVehicles(token))
      .then((page) => {
        if (!cancelled) setVehicles(page.items);
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
    const cancel = loadVehicles();
    return cancel;
    // Mount-once: session's identity is stable per its own context memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasVehicles = (vehicles?.length ?? 0) > 0;
  // With no vehicles, the form is always shown (the original first-time
  // experience, unchanged). With one or more, it's shown only when the
  // "Register another vehicle" toggle is open.
  const showRegisterForm = !hasVehicles || registerFormOpen;

  const seatCapacity = Number(seatCapacityInput);
  const seatCapacityValid = Number.isInteger(seatCapacity) && seatCapacity > 0;
  const canCreate = registrationNumber.trim().length > 0 && seatCapacityValid && !creating;

  async function handleCreate() {
    if (!canCreate || createInFlightRef.current) return;
    createInFlightRef.current = true;
    setCreating(true);
    setCreateError(null);

    try {
      // The ACTUAL returned vehicle is what gets added to the list — never
      // assumed from the form's own input values.
      const created = await withAuthRetry(session, (token) =>
        createVehicle(
          {
            registrationNumber: registrationNumber.trim(),
            vehicleType,
            seatCapacity,
            model: model.trim() || undefined,
            isAc,
          },
          token,
        ),
      );
      // Prepend — every previously-existing vehicle (including a rejected
      // one) stays in the list, untouched, never removed or overwritten.
      setVehicles((current) => [created, ...(current ?? [])]);
      // Close the form and clear it for next time, so a later "register
      // another" doesn't resurface this vehicle's now-stale field values.
      setRegisterFormOpen(false);
      setRegistrationNumber('');
      setVehicleType('HATCHBACK');
      setSeatCapacityInput('4');
      setModel('');
      setIsAc(false);
    } catch (cause) {
      setCreateError(cause instanceof ApiError ? cause.message : 'Something went wrong. Try again.');
    } finally {
      createInFlightRef.current = false;
      setCreating(false);
    }
  }

  function documentCount(vehicle: Vehicle, documentType: VehicleDocumentType): number {
    return vehicle.documents.filter((document) => document.documentType === documentType).length;
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}>
      <div style={{ maxWidth: 440, margin: '0 auto', padding: '20px 16px 48px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            type="button"
            aria-label="Back to driver hub"
            onClick={() => navigate('/driver')}
            style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>My vehicle</h1>
        </div>

        {loading && vehicles === null && (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '48px 0' }}>Loading…</p>
        )}

        {!loading && loadError && vehicles === null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--warning-border)' }}>
            <p style={{ margin: 0, color: 'var(--warning)', fontSize: 14 }}>{loadError}</p>
            <button
              type="button"
              onClick={() => loadVehicles()}
              style={{ height: 40, borderRadius: 'var(--radius-control)', border: '1px solid var(--border)', background: 'var(--surface-3)', color: 'var(--accent-2)', font: '600 13px var(--font-ui)', cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        )}

        {vehicles !== null && (
          <>
            {loadError && (
              <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--warning)' }}>
                Couldn't refresh — showing the last known state. {loadError}
              </p>
            )}

            {hasVehicles &&
              vehicles!.map((vehicle) => (
                <div key={vehicle.id} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 20, borderRadius: 22, background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--card-shadow)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ font: '700 18px var(--font-mono)' }}>{vehicle.registrationNumber}</span>
                    <span
                      style={{
                        borderRadius: 'var(--radius-chip)',
                        border: `1px solid ${vehicle.verificationStatus === 'VERIFIED' ? 'var(--success-border)' : 'var(--warning-border)'}`,
                        background: 'var(--surface-3)',
                        color: vehicle.verificationStatus === 'VERIFIED' ? 'var(--accent)' : 'var(--warning)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        letterSpacing: '.08em',
                        padding: '3px 9px',
                      }}
                    >
                      {vehicle.verificationStatus}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-2)' }}>
                    <span>{vehicle.vehicleType} · {vehicle.seatCapacity} seats{vehicle.isAc ? ' · AC' : ''}</span>
                  </div>
                  {vehicle.model && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{vehicle.model}</span>
                  )}

                  {vehicle.verificationStatus === 'PENDING' && (
                    <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)' }}>
                      Awaiting admin review — you can still upload documents below while this is pending.
                    </p>
                  )}
                  {vehicle.verificationStatus === 'VERIFIED' && (
                    <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)' }}>
                      Verified — eligible to be used when you offer a ride.
                    </p>
                  )}
                  {vehicle.verificationStatus === 'REJECTED' && (
                    <>
                      {vehicle.rejectionReason && (
                        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--warning)' }}>
                          {vehicle.rejectionReason}
                        </p>
                      )}
                      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)' }}>
                        There's currently no way to resubmit this vehicle for review. Uploading another
                        document here does not change its verification status.
                      </p>
                    </>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.14em', color: 'var(--text-muted)' }}>
                    DOCUMENTS
                  </span>
                  {VEHICLE_DOCUMENT_TYPES.map((documentType) => (
                    <DocumentUploadRow
                      key={documentType}
                      vehicleId={vehicle.id}
                      documentType={documentType}
                      uploadedCount={documentCount(vehicle, documentType)}
                      onUploaded={() => loadVehicles()}
                    />
                  ))}
                </div>
                </div>
              ))}

            {hasVehicles && (
              <button
                type="button"
                onClick={() => setRegisterFormOpen((open) => !open)}
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
                {registerFormOpen ? 'Hide' : 'Register another vehicle'}
              </button>
            )}

            {showRegisterForm && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 20, borderRadius: 22, background: 'var(--surface-1)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--card-shadow)' }}>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)' }}>
                  Register the vehicle you'll drive for SaathiRide. An admin will need to verify it
                  (and its documents) before you can use it to offer a ride.
                </p>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Registration number</span>
                  <input
                    type="text"
                    value={registrationNumber}
                    onChange={(event) => setRegistrationNumber(event.target.value)}
                    placeholder="KA 01 AB 1234"
                    style={inputStyle}
                  />
                </label>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Vehicle type</span>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {VEHICLE_TYPES.map((type) => {
                      const on = type === vehicleType;
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setVehicleType(type)}
                          style={{
                            height: 40,
                            padding: '0 14px',
                            borderRadius: 999,
                            cursor: 'pointer',
                            font: '600 12px var(--font-ui)',
                            background: on ? 'rgba(11,129,147,.12)' : 'var(--surface-2)',
                            color: on ? 'var(--text)' : 'var(--text-2)',
                            border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                          }}
                        >
                          {type}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Seat capacity</span>
                  <input
                    type="number"
                    min={1}
                    value={seatCapacityInput}
                    onChange={(event) => setSeatCapacityInput(event.target.value)}
                    style={{
                      ...inputStyle,
                      border: `1px solid ${seatCapacityValid ? 'var(--border)' : 'var(--warning-border)'}`,
                    }}
                  />
                  {!seatCapacityValid && (
                    <span style={{ fontSize: 11, color: 'var(--warning)' }}>Enter a whole number of 1 or more.</span>
                  )}
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Model (optional)</span>
                  <input
                    type="text"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="e.g. Swift Dzire"
                    style={inputStyle}
                  />
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-2)' }}>
                  <input type="checkbox" checked={isAc} onChange={(event) => setIsAc(event.target.checked)} />
                  Air-conditioned
                </label>

                {createError && (
                  <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--warning)' }}>
                    {createError}
                  </p>
                )}

                <button
                  type="button"
                  disabled={!canCreate}
                  onClick={() => void handleCreate()}
                  style={{
                    height: 50,
                    borderRadius: 'var(--radius-control)',
                    border: 0,
                    background: canCreate ? 'var(--accent)' : 'var(--surface-3)',
                    color: canCreate ? 'var(--accent-on)' : 'var(--text-muted)',
                    font: '700 14px var(--font-ui)',
                    cursor: canCreate ? 'pointer' : 'not-allowed',
                  }}
                >
                  {creating ? 'Registering…' : 'Register vehicle'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

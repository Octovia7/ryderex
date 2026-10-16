import { ChevronLeft } from 'lucide-react';
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
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { FileUpload } from '../components/ui/FileUpload';
import { Field, TextInput } from '../components/ui/Input';
import { cn } from '../lib/cn';

const DOCUMENT_LABELS: Record<VehicleDocumentType, string> = {
  RC: 'Registration certificate (RC)',
  INSURANCE: 'Insurance',
  POLLUTION: 'Pollution certificate',
};

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

  const canUpload = file !== null && !uploading;

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
    <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-slate-50 p-3.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold text-ink">{DOCUMENT_LABELS[documentType]}</span>
        <span className="text-xs text-ink-muted">
          {uploadedCount > 0 ? `${uploadedCount} uploaded` : 'None uploaded yet'}
        </span>
      </div>

      <FileUpload label="" value={file} onChange={setFile} disabled={uploading} />

      {uploadError && <p role="alert" className="text-xs text-red-600">{uploadError}</p>}

      <Button size="sm" disabled={!canUpload} loading={uploading} onClick={() => void handleUpload()}>
        Upload
      </Button>
    </div>
  );
}

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
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Back to driver hub"
          onClick={() => navigate('/driver')}
          className="flex size-10 items-center justify-center rounded-lg border border-border-strong bg-surface text-ink-muted transition-colors hover:bg-slate-50"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <h1 className="text-xl font-semibold tracking-tight text-ink">My vehicle</h1>
      </div>

      {loading && vehicles === null && <p className="py-12 text-center text-sm text-ink-muted">Loading…</p>}

      {!loading && loadError && vehicles === null && (
        <Card className="border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{loadError}</p>
          <Button variant="secondary" size="sm" className="mt-3 w-fit" onClick={() => loadVehicles()}>
            Try again
          </Button>
        </Card>
      )}

      {vehicles !== null && (
        <>
          {loadError && (
            <p role="alert" className="text-xs text-red-600">
              Couldn't refresh — showing the last known state. {loadError}
            </p>
          )}

          {hasVehicles &&
            vehicles.map((vehicle) => (
              <div key={vehicle.id} className="flex flex-col gap-4">
                <Card className="flex flex-col gap-2.5 p-5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-lg font-bold text-ink">{vehicle.registrationNumber}</span>
                    <span
                      className={cn(
                        'rounded-full border bg-slate-50 px-2.5 py-0.5 font-mono text-[10px] tracking-wider',
                        vehicle.verificationStatus === 'VERIFIED'
                          ? 'border-emerald-300 text-accent-700'
                          : 'border-amber-300 text-amber-700',
                      )}
                    >
                      {vehicle.verificationStatus}
                    </span>
                  </div>
                  <span className="text-sm text-ink">
                    {vehicle.vehicleType} · {vehicle.seatCapacity} seats{vehicle.isAc ? ' · AC' : ''}
                  </span>
                  {vehicle.model && <span className="text-xs text-ink-muted">{vehicle.model}</span>}

                  {vehicle.verificationStatus === 'PENDING' && (
                    <p className="text-xs leading-relaxed text-ink-muted">
                      Awaiting admin review — you can still upload documents below while this is pending.
                    </p>
                  )}
                  {vehicle.verificationStatus === 'VERIFIED' && (
                    <p className="text-xs leading-relaxed text-ink-muted">
                      Verified — eligible to be used when you offer a ride.
                    </p>
                  )}
                  {vehicle.verificationStatus === 'REJECTED' && (
                    <>
                      {vehicle.rejectionReason && (
                        <p className="text-xs leading-relaxed text-red-600">{vehicle.rejectionReason}</p>
                      )}
                      <p className="text-xs leading-relaxed text-ink-muted">
                        There's currently no way to resubmit this vehicle for review. Uploading another
                        document here does not change its verification status.
                      </p>
                    </>
                  )}
                </Card>

                <div className="flex flex-col gap-2.5">
                  <span className="font-mono text-[10px] tracking-wider text-ink-muted">DOCUMENTS</span>
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
            <Button variant="secondary" onClick={() => setRegisterFormOpen((open) => !open)}>
              {registerFormOpen ? 'Hide' : 'Register another vehicle'}
            </Button>
          )}

          {showRegisterForm && (
            <Card className="flex flex-col gap-4 p-5">
              <p className="text-sm text-ink-muted">
                Register the vehicle you'll drive for Ryderex. An admin will need to verify it
                (and its documents) before you can use it to offer a ride.
              </p>

              <Field label="Registration number">
                {({ id }) => (
                  <TextInput
                    id={id}
                    value={registrationNumber}
                    onChange={(event) => setRegistrationNumber(event.target.value)}
                    placeholder="KA 01 AB 1234"
                  />
                )}
              </Field>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-ink">Vehicle type</span>
                <div className="flex flex-wrap gap-2">
                  {VEHICLE_TYPES.map((type) => {
                    const on = type === vehicleType;
                    return (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setVehicleType(type)}
                        className={cn(
                          'h-10 rounded-full border px-3.5 text-xs font-semibold transition-colors',
                          on
                            ? 'border-accent-700 bg-accent-50 text-ink'
                            : 'border-border-strong bg-surface text-ink-muted',
                        )}
                      >
                        {type}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Field
                label="Seat capacity"
                error={!seatCapacityValid ? 'Enter a whole number of 1 or more.' : undefined}
              >
                {({ id }) => (
                  <TextInput
                    id={id}
                    type="number"
                    min={1}
                    value={seatCapacityInput}
                    onChange={(event) => setSeatCapacityInput(event.target.value)}
                    invalid={!seatCapacityValid}
                  />
                )}
              </Field>

              <Field label="Model (optional)">
                {({ id }) => (
                  <TextInput
                    id={id}
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="e.g. Swift Dzire"
                  />
                )}
              </Field>

              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={isAc} onChange={(event) => setIsAc(event.target.checked)} />
                Air-conditioned
              </label>

              {createError && <p role="alert" className="text-xs text-red-600">{createError}</p>}

              <Button disabled={!canCreate} loading={creating} onClick={() => void handleCreate()}>
                Register vehicle
              </Button>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

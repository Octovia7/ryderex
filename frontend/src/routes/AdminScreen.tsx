import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  listDriverApplications,
  listPendingVehicles,
  rejectDriverApplication,
  rejectVehicle,
  verifyDriverApplication,
  verifyVehicle,
  type DriverApplication,
} from '@/api/admin';
import type { Vehicle } from '@/api/vehicles';
import { withAuthRetry } from '@/api/withAuthRetry';
import { useSession } from '@/auth/session';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Textarea } from '@/components/ui/Input';
import { ListSkeleton } from '@/components/ui/Skeleton';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';

type PendingReject = { kind: 'application' | 'vehicle'; id: string; label: string } | null;

function DriverApplicationsTab() {
  const session = useSession();
  const { toast } = useToast();
  const [items, setItems] = useState<DriverApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PendingReject>(null);
  const [reason, setReason] = useState('');

  async function load() {
    try {
      const page = await withAuthRetry(session, (token) =>
        listDriverApplications('PENDING', token),
      );
      setItems(page.items);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load driver applications.');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleVerify(userId: string) {
    setBusyId(userId);
    try {
      await withAuthRetry(session, (token) => verifyDriverApplication(userId, token));
      setItems((current) => current?.filter((item) => item.userId !== userId) ?? current);
      toast('Driver licence verified.', 'success');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Could not verify this application.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject() {
    if (rejecting === null || reason.trim().length === 0) return;
    setBusyId(rejecting.id);
    try {
      await withAuthRetry(session, (token) =>
        rejectDriverApplication(rejecting.id, reason.trim(), token),
      );
      setItems((current) => current?.filter((item) => item.userId !== rejecting.id) ?? current);
      toast('Application rejected.', 'success');
      setRejecting(null);
      setReason('');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Could not reject this application.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  if (items === null && error === null) return <ListSkeleton rows={3} />;
  if (error !== null) return <p className="text-sm text-red-600">{error}</p>;
  if (items !== null && items.length === 0) {
    return <p className="text-sm text-ink-muted">No pending driver applications.</p>;
  }

  return (
    <>
      <div className="space-y-3">
        {items?.map((item) => (
          <Card key={item.userId}>
            <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-ink">{item.name}</p>
                <p className="text-sm text-ink-muted">{item.email} · {item.phone}</p>
                {item.document && (
                  <a
                    href={item.document.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent-700 hover:underline"
                  >
                    <FileText className="size-3.5" aria-hidden />
                    View licence document
                  </a>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busyId === item.userId}
                  onClick={() => {
                    setRejecting({ kind: 'application', id: item.userId, label: item.name });
                  }}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  loading={busyId === item.userId}
                  onClick={() => {
                    void handleVerify(item.userId);
                  }}
                >
                  Verify
                </Button>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <Dialog
        open={rejecting?.kind === 'application'}
        onOpenChange={(open) => {
          if (!open) {
            setRejecting(null);
            setReason('');
          }
        }}
        title={`Reject ${rejecting?.label ?? 'application'}?`}
        description="This reason is shown to the applicant."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setRejecting(null);
                setReason('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busyId === rejecting?.id}
              disabled={reason.trim().length === 0}
              onClick={() => {
                void handleReject();
              }}
            >
              Reject application
            </Button>
          </>
        }
      >
        <Textarea
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          placeholder="e.g. Licence image is unreadable"
          autoFocus
        />
      </Dialog>
    </>
  );
}

function VehiclesTab() {
  const session = useSession();
  const { toast } = useToast();
  const [items, setItems] = useState<Vehicle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PendingReject>(null);
  const [reason, setReason] = useState('');

  async function load() {
    try {
      const page = await withAuthRetry(session, (token) => listPendingVehicles('PENDING', token));
      setItems(page.items);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load vehicles.');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleVerify(vehicleId: string) {
    setBusyId(vehicleId);
    try {
      await withAuthRetry(session, (token) => verifyVehicle(vehicleId, token));
      setItems((current) => current?.filter((item) => item.id !== vehicleId) ?? current);
      toast('Vehicle verified.', 'success');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Could not verify this vehicle.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject() {
    if (rejecting === null || reason.trim().length === 0) return;
    setBusyId(rejecting.id);
    try {
      await withAuthRetry(session, (token) => rejectVehicle(rejecting.id, reason.trim(), token));
      setItems((current) => current?.filter((item) => item.id !== rejecting.id) ?? current);
      toast('Vehicle rejected.', 'success');
      setRejecting(null);
      setReason('');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Could not reject this vehicle.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  if (items === null && error === null) return <ListSkeleton rows={3} />;
  if (error !== null) return <p className="text-sm text-red-600">{error}</p>;
  if (items !== null && items.length === 0) {
    return <p className="text-sm text-ink-muted">No pending vehicles.</p>;
  }

  return (
    <>
      <div className="space-y-3">
        {items?.map((item) => (
          <Card key={item.id}>
            <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-ink">{item.registrationNumber}</p>
                <p className="text-sm text-ink-muted">
                  {item.vehicleType} · {item.seatCapacity} seats{item.model ? ` · ${item.model}` : ''}
                </p>
                {item.documents.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-3">
                    {item.documents.map((doc) => (
                      <a
                        key={doc.id}
                        href={doc.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-accent-700 hover:underline"
                      >
                        <FileText className="size-3.5" aria-hidden />
                        {doc.documentType}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busyId === item.id}
                  onClick={() => {
                    setRejecting({ kind: 'vehicle', id: item.id, label: item.registrationNumber });
                  }}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  loading={busyId === item.id}
                  onClick={() => {
                    void handleVerify(item.id);
                  }}
                >
                  Verify
                </Button>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <Dialog
        open={rejecting?.kind === 'vehicle'}
        onOpenChange={(open) => {
          if (!open) {
            setRejecting(null);
            setReason('');
          }
        }}
        title={`Reject ${rejecting?.label ?? 'vehicle'}?`}
        description="This reason is shown to the vehicle's owner."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setRejecting(null);
                setReason('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busyId === rejecting?.id}
              disabled={reason.trim().length === 0}
              onClick={() => {
                void handleReject();
              }}
            >
              Reject vehicle
            </Button>
          </>
        }
      >
        <Textarea
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          placeholder="e.g. Insurance document has expired"
          autoFocus
        />
      </Dialog>
    </>
  );
}

// ADMIN-only (RequireRole on the route). Two review queues — driving
// licences and vehicle documents — matching the backend's admin module
// exactly, which owns no other workflow (no user management, no ride/
// booking/financial overrides).
export function AdminScreen() {
  const [tab, setTab] = useState<'applications' | 'vehicles'>('applications');

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">Admin</h1>
      <p className="mt-1 text-sm text-ink-muted">Review pending driver licences and vehicles.</p>

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as 'applications' | 'vehicles');
        }}
        items={[
          { value: 'applications', label: 'Driver applications' },
          { value: 'vehicles', label: 'Vehicles' },
        ]}
        className="mt-5"
      >
        <TabPanel value="applications" className="mt-4">
          <DriverApplicationsTab />
        </TabPanel>
        <TabPanel value="vehicles" className="mt-4">
          <VehiclesTab />
        </TabPanel>
      </Tabs>
    </div>
  );
}

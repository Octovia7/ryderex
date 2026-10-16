import { apiFetch } from './client';
import type { Vehicle } from './vehicles';

// Verified against src/modules/user/services/userService.ts's
// listDriverApplications mapping.
export interface DriverApplication {
  userId: string;
  name: string;
  email: string;
  phone: string;
  driverLicenseStatus: string;
  driverLicenseRejectionReason: string | null;
  submittedAt: string;
  document: { id: string; url: string } | null;
}

// Every route here is gated authorize('ADMIN') server-side — the only
// module in the API that uses a role check rather than an ownership check.
export function listDriverApplications(
  status: 'PENDING' | 'VERIFIED' | 'REJECTED' = 'PENDING',
  accessToken?: string | null,
): Promise<{ items: DriverApplication[] }> {
  return apiFetch(`/admin/driver-applications?status=${status}`, { accessToken });
}

export function verifyDriverApplication(
  userId: string,
  accessToken?: string | null,
): Promise<null> {
  return apiFetch(`/admin/driver-applications/${userId}/verify`, { method: 'POST', accessToken });
}

export function rejectDriverApplication(
  userId: string,
  rejectionReason: string,
  accessToken?: string | null,
): Promise<null> {
  return apiFetch(`/admin/driver-applications/${userId}/reject`, {
    method: 'POST',
    body: { rejectionReason },
    accessToken,
  });
}

export function listPendingVehicles(
  status: 'PENDING' | 'VERIFIED' | 'REJECTED' = 'PENDING',
  accessToken?: string | null,
): Promise<{ items: Vehicle[] }> {
  return apiFetch(`/admin/vehicles?status=${status}`, { accessToken });
}

export function getVehicleForReview(
  vehicleId: string,
  accessToken?: string | null,
): Promise<Vehicle> {
  return apiFetch(`/admin/vehicles/${vehicleId}`, { accessToken });
}

export function verifyVehicle(vehicleId: string, accessToken?: string | null): Promise<null> {
  return apiFetch(`/admin/vehicles/${vehicleId}/verify`, { method: 'POST', accessToken });
}

export function rejectVehicle(
  vehicleId: string,
  rejectionReason: string,
  accessToken?: string | null,
): Promise<null> {
  return apiFetch(`/admin/vehicles/${vehicleId}/reject`, {
    method: 'POST',
    body: { rejectionReason },
    accessToken,
  });
}

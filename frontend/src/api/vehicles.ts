import { API_BASE_URL } from './config';
import { apiFetch, ApiError } from './client';

// Verified against prisma/schema.prisma's Vehicle model — toVehicleDto
// (src/modules/vehicle/services/vehicleService.ts) is a plain spread of the
// repository row plus mapped documents, so these are the model's own fields.
export const VEHICLE_TYPES = ['HATCHBACK', 'SEDAN', 'MUV', 'SUV'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export interface VehicleDocument {
  id: string;
  documentType: string;
  url: string;
  createdAt: string;
}

export interface Vehicle {
  id: string;
  ownerId: string;
  registrationNumber: string;
  vehicleType: VehicleType;
  seatCapacity: number;
  model: string | null;
  isAc: boolean;
  status: VehicleStatus;
  verificationStatus: VerificationStatus;
  verifiedBy: string | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  documents: VehicleDocument[];
  createdAt: string;
  updatedAt: string;
}

// GET /api/v1/vehicles — no role gate server-side; scoped to the caller's
// own vehicles in the service (src/modules/vehicle/controllers/
// vehicleController.ts's listVehicles -> vehicleService.listOwnVehicles).
export function listVehicles(accessToken?: string | null): Promise<{ items: Vehicle[] }> {
  return apiFetch('/vehicles', { accessToken });
}

// Verified against src/modules/vehicle/schemas/createVehicle.schema.ts.
// `registrationNumber` is normalized (uppercased, whitespace/hyphens
// stripped) server-side before the uniqueness check — this layer sends it
// as typed, never pre-normalizes it itself. `status`/`verificationStatus`
// and every other server-controlled field are never accepted here; the
// schema would silently strip them anyway.
export interface CreateVehicleInput {
  registrationNumber: string;
  vehicleType: VehicleType;
  seatCapacity: number;
  model?: string;
  isAc?: boolean;
}

// POST /api/v1/vehicles — role-gated DRIVER server-side (the only vehicle
// route with a role gate; src/modules/vehicle/routes.ts). Returns the full
// Vehicle DTO — always `verificationStatus: 'PENDING'`, `status: 'ACTIVE'`
// on creation (Prisma column defaults, never a caller's choice). 409
// REGISTRATION_NUMBER_ALREADY_IN_USE on a normalized collision.
export function createVehicle(
  input: CreateVehicleInput,
  accessToken?: string | null,
): Promise<Vehicle> {
  return apiFetch('/vehicles', { method: 'POST', body: input, accessToken });
}

// Verified against prisma/schema.prisma's VehicleDocumentType enum.
export const VEHICLE_DOCUMENT_TYPES = ['RC', 'INSURANCE', 'POLLUTION'] as const;
export type VehicleDocumentType = (typeof VEHICLE_DOCUMENT_TYPES)[number];

// POST /api/v1/vehicles/:id/documents — multipart/form-data, TWO parts: the
// file (field "document", src/middleware/uploadDocument.ts's
// uploadDocument.single('document')) and a text field "documentType"
// (src/modules/vehicle/schemas/uploadVehicleDocument.schema.ts — multer
// parses both into the same request, text fields land in req.body). A
// deliberately separate client from ./client.ts's apiFetch, the same
// convention ./driverApplication.ts already uses: apiFetch always
// JSON.stringifies its body and sets Content-Type: application/json,
// neither of which can carry a file upload. `Content-Type` is intentionally
// never set here — the browser generates FormData's own multipart boundary,
// and setting it manually would break that boundary.
//
// Ownership-scoped server-side (404 for a non-owner), no role gate. Note:
// there is no uniqueness constraint on (vehicleId, documentType) — a
// second upload of the same type ADDS another document row, it does not
// replace the first, and it does NOT reset verificationStatus or trigger
// any re-review — no such endpoint exists (verify/reject only ever
// transition FROM PENDING; there is no REJECTED -> PENDING path at all).
export async function uploadVehicleDocument(
  vehicleId: string,
  documentType: VehicleDocumentType,
  file: File,
  accessToken?: string | null,
): Promise<VehicleDocument> {
  const formData = new FormData();
  formData.append('document', file);
  formData.append('documentType', documentType);

  const headers: Record<string, string> = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/vehicles/${vehicleId}/documents`, {
      method: 'POST',
      headers,
      body: formData,
    });
  } catch {
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server. Check your connection and try again.',
      statusCode: 0,
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError({
      code: 'INVALID_RESPONSE',
      message: 'The server returned an unexpected response.',
      statusCode: response.status,
    });
  }

  const body = payload as
    | { success: true; data: VehicleDocument }
    | { success: false; error: { code: string; message: string }; requestId?: string };

  if (!body.success) {
    throw new ApiError({
      code: body.error.code,
      message: body.error.message,
      statusCode: response.status,
      requestId: body.requestId,
    });
  }

  return body.data;
}

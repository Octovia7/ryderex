import { API_BASE_URL } from './config';
import { ApiError } from './client';

// Verified against src/modules/user/controllers/userController.ts's
// submitDriverApplication — the only field this response ever carries.
export interface DriverApplicationResult {
  status: 'PENDING';
}

// POST /api/v1/users/me/driver-application — multipart/form-data, one file
// field named "document" (src/middleware/uploadDocument.ts's
// uploadDocument.single('document')). A deliberately separate client from
// ./client.ts's apiFetch, the same convention ./places.ts and
// ./razorpayCheckout.ts already use: apiFetch always JSON.stringifies its
// body and sets Content-Type: application/json, neither of which can carry
// a file upload. `Content-Type` is intentionally never set here — the
// browser generates FormData's own multipart boundary, and setting it
// manually would break that boundary.
//
// Allowed only while the caller's driverLicenseStatus is null or REJECTED
// (userRepository.markDriverApplicationPending's own WHERE); 409
// DRIVER_APPLICATION_PENDING otherwise — surfaced as-is, never
// reinterpreted here. No role gate exists on this route server-side, but
// it is only ever meaningful for a PASSENGER in one of those two states;
// callers (DriverApplicationScreen) are responsible for only reaching this
// function from that state, this layer does not re-check it.
export async function submitDriverApplication(
  file: File,
  accessToken?: string | null,
): Promise<DriverApplicationResult> {
  const formData = new FormData();
  formData.append('document', file);

  const headers: Record<string, string> = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/users/me/driver-application`, {
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
    | { success: true; data: DriverApplicationResult }
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

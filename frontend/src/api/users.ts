import { apiFetch } from './client';
import type { User } from './auth';

// GET /api/v1/users/me — the caller's own profile, the identical User
// shape login/refresh already return (src/modules/user/services/
// userService.ts's UserDto — same fields, confirmed field-for-field).
// Scoped to req.user.id; no parameter can ever request anyone else's.
export function getMe(accessToken?: string | null): Promise<User> {
  return apiFetch('/users/me', { accessToken });
}

// Verified against src/modules/user/schemas/updateProfile.schema.ts — only
// these four fields are ever accepted; the backend silently strips any
// other key (role, status, ratings, ...). `profileImageUrl` must be a
// valid URL if sent — there is no file-upload endpoint for it, and no way
// to clear it back to null once set (the schema has no null-accepting
// path), only to replace it with a different URL.
export interface UpdateProfileInput {
  name?: string;
  phone?: string;
  email?: string;
  profileImageUrl?: string;
}

// PATCH /api/v1/users/me — at least one field is required (the backend's
// own schema rejects an empty body with 400 VALIDATION_ERROR); a duplicate
// email/phone is rejected with 409 EMAIL_ALREADY_IN_USE /
// 409 PHONE_ALREADY_IN_USE. Returns the updated profile — callers should
// treat that response, not their own pre-submit form state, as what was
// actually saved.
export function updateMe(
  input: UpdateProfileInput,
  accessToken?: string | null,
): Promise<User> {
  return apiFetch('/users/me', { method: 'PATCH', body: input, accessToken });
}

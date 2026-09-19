import type { DriverLicenseStatus } from '../../../generated/prisma/enums';
import * as userService from '../../user/services/userService';

// The admin module owns no tables of its own — User/UserDocument belong to
// the user module, so every persistence need is delegated to its service
// rather than reaching into userRepository directly.
export function listDriverApplications(status: DriverLicenseStatus) {
  return userService.listDriverApplications(status);
}

export function verifyDriverApplication(userId: string, adminId: string): Promise<void> {
  return userService.verifyDriverLicense(userId, adminId);
}

export function rejectDriverApplication(
  userId: string,
  adminId: string,
  reason: string,
): Promise<void> {
  return userService.rejectDriverLicense(userId, adminId, reason);
}

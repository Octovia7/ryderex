import type { VerificationStatus } from '../../../generated/prisma/enums';
import * as vehicleService from '../../vehicle/services/vehicleService';

// Vehicle/VehicleDocument belong to the vehicle module, so the admin module
// delegates to its service rather than reaching into vehicleRepository.
export function listVehicles(status: VerificationStatus) {
  return vehicleService.listVehiclesForReview(status);
}

export function getVehicle(vehicleId: string) {
  return vehicleService.getVehicleForReview(vehicleId);
}

export function verifyVehicle(vehicleId: string, adminId: string): Promise<void> {
  return vehicleService.verifyVehicle(vehicleId, adminId);
}

export function rejectVehicle(vehicleId: string, adminId: string, reason: string): Promise<void> {
  return vehicleService.rejectVehicle(vehicleId, adminId, reason);
}

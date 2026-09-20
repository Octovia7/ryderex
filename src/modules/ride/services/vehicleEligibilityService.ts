import type { VehicleType } from '../../../generated/prisma/enums';
import { AppError } from '../../../shared/AppError';
import * as vehicleService from '../../vehicle/services/vehicleService';

function notEligible(message: string): AppError {
  return new AppError({ statusCode: 409, code: 'VEHICLE_NOT_ELIGIBLE', message });
}

// The single place that decides whether a vehicle may be used to post a
// ride: it must belong to the driver (404 otherwise, via the vehicle
// service), be ACTIVE, be admin-VERIFIED, and have room for the seats
// offered. Verification was originally a display-only trust signal; it gates
// ride creation now, so don't relax it here.
export async function assertVehicleEligibleForRide(
  driverId: string,
  vehicleId: string,
  totalSeats: number,
): Promise<{ vehicleType: VehicleType }> {
  const vehicle = await vehicleService.getVehicleForRideCreation(driverId, vehicleId);

  if (vehicle.status !== 'ACTIVE') {
    throw notEligible('This vehicle is not active.');
  }

  if (vehicle.verificationStatus !== 'VERIFIED') {
    throw notEligible('This vehicle has not been verified by an admin.');
  }

  if (totalSeats > vehicle.seatCapacity) {
    throw notEligible("The requested seats exceed the vehicle's seat capacity.");
  }

  return { vehicleType: vehicle.vehicleType };
}

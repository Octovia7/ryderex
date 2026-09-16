import { getUniqueConstraintFields } from '../../../infrastructure/database/prismaErrors';
import { AppError } from '../../../shared/AppError';
import type { CreateVehicleInput } from '../schemas/createVehicle.schema';
import type { UpdateVehicleInput } from '../schemas/updateVehicle.schema';
import * as vehicleRepository from '../repositories/vehicleRepository';

function mapUniqueConstraintError(error: unknown): never {
  const fields = getUniqueConstraintFields(error);

  if (fields?.includes('registrationNumber')) {
    throw new AppError({
      statusCode: 409,
      code: 'REGISTRATION_NUMBER_ALREADY_IN_USE',
      message: 'A vehicle with this registration number already exists.',
      cause: error,
    });
  }

  throw error;
}

// "Exists but isn't yours" and "doesn't exist" are indistinguishable to the
// caller, so a non-owner always gets 404 — never 403 — and existence is
// never leaked across drivers.
async function getOwnedVehicleOrThrow(ownerId: string, vehicleId: string) {
  const vehicle = await vehicleRepository.findById(vehicleId);

  if (!vehicle || vehicle.ownerId !== ownerId) {
    throw new AppError({
      statusCode: 404,
      code: 'VEHICLE_NOT_FOUND',
      message: 'Vehicle not found.',
    });
  }

  return vehicle;
}

export async function createVehicle(ownerId: string, input: CreateVehicleInput) {
  try {
    return await vehicleRepository.create({
      ownerId,
      registrationNumber: input.registrationNumber,
      vehicleType: input.vehicleType,
      seatCapacity: input.seatCapacity,
    });
  } catch (error) {
    mapUniqueConstraintError(error);
  }
}

export function listOwnVehicles(ownerId: string) {
  return vehicleRepository.findManyByOwner(ownerId);
}

export function getOwnVehicle(ownerId: string, vehicleId: string) {
  return getOwnedVehicleOrThrow(ownerId, vehicleId);
}

export async function updateOwnVehicle(
  ownerId: string,
  vehicleId: string,
  input: UpdateVehicleInput,
) {
  await getOwnedVehicleOrThrow(ownerId, vehicleId);

  try {
    return await vehicleRepository.updateById(vehicleId, input);
  } catch (error) {
    mapUniqueConstraintError(error);
  }
}

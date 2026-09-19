import type { VehicleDocumentType } from '../../../generated/prisma/enums';
import { documentProvider } from '../../../infrastructure/cloudinary';
import { getUniqueConstraintFields } from '../../../infrastructure/database/prismaErrors';
import { AppError } from '../../../shared/AppError';
import type { CreateVehicleInput } from '../schemas/createVehicle.schema';
import type { UpdateVehicleInput } from '../schemas/updateVehicle.schema';
import * as vehicleDocumentRepository from '../repositories/vehicleDocumentRepository';
import * as vehicleRepository from '../repositories/vehicleRepository';

interface RepositoryDocument {
  id: string;
  documentType: string;
  cloudinaryPublicId: string;
  createdAt: Date;
}

interface RepositoryVehicle {
  documents: RepositoryDocument[];
}

export interface VehicleDocumentDto {
  id: string;
  documentType: string;
  url: string;
  createdAt: Date;
}

// The stored Cloudinary reference is internal. Every read mints a fresh signed
// URL from it — no permanently-usable link is ever stored or returned.
export function toDocumentDto(document: RepositoryDocument): VehicleDocumentDto {
  return {
    id: document.id,
    documentType: document.documentType,
    url: documentProvider.getSignedUrl(document.cloudinaryPublicId),
    createdAt: document.createdAt,
  };
}

export function toVehicleDto<T extends RepositoryVehicle>(
  vehicle: T,
): Omit<T, 'documents'> & { documents: VehicleDocumentDto[] } {
  return { ...vehicle, documents: vehicle.documents.map(toDocumentDto) };
}

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
    const vehicle = await vehicleRepository.create({
      ownerId,
      registrationNumber: input.registrationNumber,
      vehicleType: input.vehicleType,
      seatCapacity: input.seatCapacity,
    });
    return toVehicleDto(vehicle);
  } catch (error) {
    mapUniqueConstraintError(error);
  }
}

export async function listOwnVehicles(ownerId: string) {
  const vehicles = await vehicleRepository.findManyByOwner(ownerId);
  return vehicles.map(toVehicleDto);
}

export async function getOwnVehicle(ownerId: string, vehicleId: string) {
  const vehicle = await getOwnedVehicleOrThrow(ownerId, vehicleId);
  return toVehicleDto(vehicle);
}

export async function updateOwnVehicle(
  ownerId: string,
  vehicleId: string,
  input: UpdateVehicleInput,
) {
  await getOwnedVehicleOrThrow(ownerId, vehicleId);

  try {
    const vehicle = await vehicleRepository.updateById(vehicleId, input);
    return toVehicleDto(vehicle);
  } catch (error) {
    mapUniqueConstraintError(error);
  }
}

// Ownership is checked first, so a non-owner never triggers an upload. The
// external upload then happens before — and never inside — the database write;
// if the upload throws, no document row is created. A failed insert after a
// successful upload would leave an orphaned Cloudinary asset, the same accepted
// trade-off documented for driver applications (no compensating delete exists
// on the two-method DocumentProvider).
export async function uploadVehicleDocument(
  ownerId: string,
  vehicleId: string,
  documentType: VehicleDocumentType,
  file: { buffer: Buffer },
): Promise<VehicleDocumentDto> {
  await getOwnedVehicleOrThrow(ownerId, vehicleId);

  const folder = `vehicles/${vehicleId}/documents`;
  const { publicId } = await documentProvider.uploadDocument({ buffer: file.buffer, folder });

  const document = await vehicleDocumentRepository.create({
    vehicleId,
    documentType,
    cloudinaryPublicId: publicId,
  });

  return toDocumentDto(document);
}

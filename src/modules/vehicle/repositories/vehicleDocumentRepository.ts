import type { VehicleDocumentType } from '../../../generated/prisma/enums';
import { prisma } from '../../../infrastructure/database/prismaClient';

export interface CreateVehicleDocumentData {
  vehicleId: string;
  documentType: VehicleDocumentType;
  cloudinaryPublicId: string;
}

export function create(data: CreateVehicleDocumentData) {
  return prisma.vehicleDocument.create({
    data,
    select: { id: true, documentType: true, cloudinaryPublicId: true, createdAt: true },
  });
}

import type { VehicleType, VerificationStatus } from '../../../generated/prisma/enums';
import { prisma } from '../../../infrastructure/database/prismaClient';

const SELECT = {
  id: true,
  ownerId: true,
  registrationNumber: true,
  vehicleType: true,
  seatCapacity: true,
  status: true,
  verificationStatus: true,
  verifiedBy: true,
  verifiedAt: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
  documents: {
    select: { id: true, documentType: true, cloudinaryPublicId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
} as const;

// Admin review additionally needs to know who to contact about the vehicle.
const REVIEW_SELECT = {
  ...SELECT,
  owner: { select: { id: true, name: true, email: true, phone: true } },
} as const;

export interface CreateVehicleData {
  ownerId: string;
  registrationNumber: string;
  vehicleType: VehicleType;
  seatCapacity: number;
}

export function create(data: CreateVehicleData) {
  return prisma.vehicle.create({ data, select: SELECT });
}

export function findManyByOwner(ownerId: string) {
  return prisma.vehicle.findMany({
    where: { ownerId },
    select: SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

export function findById(id: string) {
  return prisma.vehicle.findUnique({ where: { id }, select: SELECT });
}

export function findManyByVerificationStatus(status: VerificationStatus) {
  return prisma.vehicle.findMany({
    where: { verificationStatus: status },
    select: REVIEW_SELECT,
    orderBy: { createdAt: 'asc' },
  });
}

export function findByIdForReview(id: string) {
  return prisma.vehicle.findUnique({ where: { id }, select: REVIEW_SELECT });
}

// Conditional UPDATE: the PENDING guard and the write are one statement, so two
// concurrent admin decisions can't both apply. Callers branch on the boolean.
export async function verify(id: string, adminId: string): Promise<boolean> {
  const result = await prisma.vehicle.updateMany({
    where: { id, verificationStatus: 'PENDING' },
    data: {
      verificationStatus: 'VERIFIED',
      verifiedBy: adminId,
      verifiedAt: new Date(),
    },
  });
  return result.count === 1;
}

export async function reject(id: string, adminId: string, reason: string): Promise<boolean> {
  const result = await prisma.vehicle.updateMany({
    where: { id, verificationStatus: 'PENDING' },
    data: {
      verificationStatus: 'REJECTED',
      verifiedBy: adminId,
      verifiedAt: new Date(),
      rejectionReason: reason,
    },
  });
  return result.count === 1;
}

export interface UpdateVehicleData {
  registrationNumber?: string;
  vehicleType?: VehicleType;
  seatCapacity?: number;
}

export function updateById(id: string, data: UpdateVehicleData) {
  return prisma.vehicle.update({ where: { id }, data, select: SELECT });
}

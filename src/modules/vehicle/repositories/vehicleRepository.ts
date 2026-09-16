import type { VehicleType } from '../../../generated/prisma/enums';
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

export interface UpdateVehicleData {
  registrationNumber?: string;
  vehicleType?: VehicleType;
  seatCapacity?: number;
}

export function updateById(id: string, data: UpdateVehicleData) {
  return prisma.vehicle.update({ where: { id }, data, select: SELECT });
}

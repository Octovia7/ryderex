import { prisma } from '../../../infrastructure/database/prismaClient';

const SELECT = {
  id: true,
  email: true,
  phone: true,
  name: true,
  profileImageUrl: true,
  role: true,
  status: true,
  driverRatingAverage: true,
  driverRatingCount: true,
  passengerRatingAverage: true,
  passengerRatingCount: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function findByEmail(email: string) {
  return prisma.user.findUnique({ where: { email }, select: SELECT });
}

export function findById(id: string) {
  return prisma.user.findUnique({ where: { id }, select: SELECT });
}

export function createPassenger(data: { email: string; name: string; phone: string }) {
  return prisma.user.create({
    data: { email: data.email, name: data.name, phone: data.phone },
    select: SELECT,
  });
}

export interface UpdateProfileData {
  name?: string;
  phone?: string;
  email?: string;
  profileImageUrl?: string;
}

export function updateProfile(id: string, data: UpdateProfileData) {
  return prisma.user.update({ where: { id }, data, select: SELECT });
}

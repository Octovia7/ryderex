import type { DriverLicenseStatus } from '../../../generated/prisma/enums';
import { prisma } from '../../../infrastructure/database/prismaClient';

type Client = Pick<typeof prisma, 'user'>;

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
  driverLicenseStatus: true,
  driverLicenseRejectionReason: true,
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

// Conditional UPDATE: allowed only from "never applied" (null) or REJECTED,
// so the guard and the write happen in one statement — no prior read to race.
export async function markDriverApplicationPending(
  client: Client,
  userId: string,
): Promise<boolean> {
  const result = await client.user.updateMany({
    where: {
      id: userId,
      OR: [{ driverLicenseStatus: null }, { driverLicenseStatus: 'REJECTED' }],
    },
    data: {
      driverLicenseStatus: 'PENDING',
      driverLicenseRejectionReason: null,
      driverLicenseVerifiedBy: null,
      driverLicenseVerifiedAt: null,
    },
  });
  return result.count === 1;
}

export async function verifyDriverLicense(userId: string, adminId: string): Promise<boolean> {
  const result = await prisma.user.updateMany({
    where: { id: userId, driverLicenseStatus: 'PENDING' },
    data: {
      role: 'DRIVER',
      driverLicenseStatus: 'VERIFIED',
      driverLicenseVerifiedBy: adminId,
      driverLicenseVerifiedAt: new Date(),
    },
  });
  return result.count === 1;
}

export async function rejectDriverLicense(
  userId: string,
  adminId: string,
  reason: string,
): Promise<boolean> {
  const result = await prisma.user.updateMany({
    where: { id: userId, driverLicenseStatus: 'PENDING' },
    data: {
      driverLicenseStatus: 'REJECTED',
      driverLicenseRejectionReason: reason,
      driverLicenseVerifiedBy: adminId,
      driverLicenseVerifiedAt: new Date(),
    },
  });
  return result.count === 1;
}

export function findDriverApplicationsByStatus(status: DriverLicenseStatus) {
  return prisma.user.findMany({
    where: { driverLicenseStatus: status },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      driverLicenseStatus: true,
      driverLicenseRejectionReason: true,
      createdAt: true,
      documents: {
        where: { documentType: 'DRIVER_LICENSE' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, cloudinaryPublicId: true, createdAt: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });
}

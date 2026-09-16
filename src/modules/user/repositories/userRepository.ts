import { prisma } from '../../../infrastructure/database/prismaClient';

const SELECT = {
  id: true,
  email: true,
  phone: true,
  name: true,
  role: true,
  status: true,
} as const;

export function findByEmail(email: string) {
  return prisma.user.findUnique({ where: { email }, select: SELECT });
}

export function createPassenger(data: { email: string; name: string; phone: string }) {
  return prisma.user.create({
    data: { email: data.email, name: data.name, phone: data.phone },
    select: SELECT,
  });
}

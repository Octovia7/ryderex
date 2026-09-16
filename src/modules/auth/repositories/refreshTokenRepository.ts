import { prisma } from '../../../infrastructure/database/prismaClient';

type Client = Pick<typeof prisma, 'refreshToken'>;

export function create(
  client: Client,
  data: { userId: string; tokenHash: string; deviceId: string | null; expiresAt: Date },
) {
  return client.refreshToken.create({
    data: {
      userId: data.userId,
      tokenHash: data.tokenHash,
      deviceId: data.deviceId,
      expiresAt: data.expiresAt,
    },
  });
}

export function findByTokenHashWithUser(client: Client, tokenHash: string) {
  return client.refreshToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: { id: true, role: true, status: true },
      },
    },
  });
}

// Conditional UPDATE: the guard (revokedAt IS NULL) is evaluated under the
// same lock the UPDATE itself takes, so a caller branches on the returned
// boolean rather than a prior read.
export async function revokeById(client: Client, id: string): Promise<boolean> {
  const result = await client.refreshToken.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count === 1;
}

export async function revokeAllActiveForUser(client: Client, userId: string): Promise<number> {
  const result = await client.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

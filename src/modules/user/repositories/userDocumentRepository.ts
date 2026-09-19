import { prisma } from '../../../infrastructure/database/prismaClient';

type Client = Pick<typeof prisma, 'userDocument'>;

export function create(
  client: Client,
  data: { userId: string; documentType: 'DRIVER_LICENSE'; cloudinaryPublicId: string },
) {
  return client.userDocument.create({ data });
}

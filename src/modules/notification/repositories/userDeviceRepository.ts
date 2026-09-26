import { prisma } from '../../../infrastructure/database/prismaClient';
import type { DevicePlatform } from '../../../generated/prisma/enums';

type Client = Pick<typeof prisma, 'userDevice'>;

export interface UserDeviceRecord {
  id: string;
  userId: string;
  deviceToken: string;
  platform: DevicePlatform;
  createdAt: Date;
  updatedAt: Date;
}

const SELECT = {
  id: true,
  userId: true,
  deviceToken: true,
  platform: true,
  createdAt: true,
  updatedAt: true,
} as const;

// `device_token` is globally UNIQUE, not scoped to a user (architecture.md
// §6): a physical device has one owner at a time, so a different account
// logging in on the same device REASSIGNS the existing row via upsert-by-
// token — it never creates a second one and never leaves an orphaned row
// pointing at the previous owner.
export function upsert(
  client: Client,
  userId: string,
  deviceToken: string,
  platform: DevicePlatform,
): Promise<UserDeviceRecord> {
  return client.userDevice.upsert({
    where: { deviceToken },
    create: { userId, deviceToken, platform },
    update: { userId, platform },
    select: SELECT,
  });
}

// The delivery pipeline's own lookup: every token currently registered to a
// notification's recipient.
export async function findTokensByUserId(client: Client, userId: string): Promise<string[]> {
  const devices = await client.userDevice.findMany({
    where: { userId },
    select: { deviceToken: true },
  });
  return devices.map((device) => device.deviceToken);
}

// The one exception to "no soft deletion" in this schema (architecture.md
// §6): an FCM-invalidated token is genuinely removed, not marked with a
// status — a dead registration token is not history worth keeping, and
// `user_devices` has no status column to mark it with regardless.
export async function removeTokens(client: Client, deviceTokens: string[]): Promise<void> {
  if (deviceTokens.length === 0) {
    return;
  }

  await client.userDevice.deleteMany({ where: { deviceToken: { in: deviceTokens } } });
}

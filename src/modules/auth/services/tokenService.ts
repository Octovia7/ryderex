import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../../config';
import { prisma } from '../../../infrastructure/database/prismaClient';
import { AppError } from '../../../shared/AppError';
import * as refreshTokenRepository from '../repositories/refreshTokenRepository';

export interface AccessTokenPayload {
  sub: string;
  role: string;
  type: 'access';
}

export interface AuthenticatedUser {
  id: string;
  role: string;
}

export function signAccessToken(user: AuthenticatedUser): string {
  const payload: AccessTokenPayload = { sub: user.id, role: user.role, type: 'access' };
  return jwt.sign(payload, config.jwt.accessSecret, {
    algorithm: 'HS256',
    expiresIn: `${config.jwt.accessTokenExpiryMinutes}m`,
  });
}

// A signed claim that is only cast, not checked, is not actually verified —
// the `type` claim must be asserted at runtime.
export function verifyAccessToken(token: string): AccessTokenPayload {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, config.jwt.accessSecret, { algorithms: ['HS256'] });
  } catch (cause) {
    throw new AppError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid or expired access token.',
      cause,
    });
  }

  if (
    typeof decoded !== 'object' ||
    decoded === null ||
    (decoded as { type?: unknown }).type !== 'access' ||
    typeof (decoded as { sub?: unknown }).sub !== 'string' ||
    typeof (decoded as { role?: unknown }).role !== 'string'
  ) {
    throw new AppError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Invalid access token.',
    });
  }

  return decoded as AccessTokenPayload;
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateRefreshTokenValue(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashRefreshToken(token) };
}

function refreshTokenExpiry(): Date {
  return new Date(Date.now() + config.jwt.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
}

export async function issueTokensForUser(
  user: AuthenticatedUser,
  deviceId: string | null = null,
): Promise<{ accessToken: string; refreshToken: string }> {
  const { token, tokenHash } = generateRefreshTokenValue();

  await refreshTokenRepository.create(prisma, {
    userId: user.id,
    tokenHash,
    deviceId,
    expiresAt: refreshTokenExpiry(),
  });

  return { accessToken: signAccessToken(user), refreshToken: token };
}

export type RotateRefreshTokenResult =
  | { kind: 'success'; accessToken: string; refreshToken: string; user: AuthenticatedUser }
  | { kind: 'not_found' }
  | { kind: 'reuse' }
  | { kind: 'expired' }
  | { kind: 'suspended' };

// Reuse detection and rotation share one interactive transaction. The reuse
// path must WRITE (revoke the family) before the request is rejected, and
// throwing inside a Prisma interactive transaction rolls back everything
// written in it — including that revocation. So this returns a result
// variant from the transaction and the caller throws only after it commits.
export async function rotateRefreshToken(
  presentedToken: string,
): Promise<RotateRefreshTokenResult> {
  const tokenHash = hashRefreshToken(presentedToken);

  return prisma.$transaction(async (tx) => {
    const existing = await refreshTokenRepository.findByTokenHashWithUser(tx, tokenHash);

    if (!existing) {
      return { kind: 'not_found' };
    }

    if (existing.revokedAt !== null) {
      await refreshTokenRepository.revokeAllActiveForUser(tx, existing.userId);
      return { kind: 'reuse' };
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      return { kind: 'expired' };
    }

    if (existing.user.status === 'SUSPENDED') {
      await refreshTokenRepository.revokeAllActiveForUser(tx, existing.userId);
      return { kind: 'suspended' };
    }

    await refreshTokenRepository.revokeById(tx, existing.id);

    const { token, tokenHash: replacementHash } = generateRefreshTokenValue();
    await refreshTokenRepository.create(tx, {
      userId: existing.userId,
      tokenHash: replacementHash,
      deviceId: existing.deviceId,
      expiresAt: refreshTokenExpiry(),
    });

    const user: AuthenticatedUser = { id: existing.user.id, role: existing.user.role };

    return {
      kind: 'success',
      accessToken: signAccessToken(user),
      refreshToken: token,
      user,
    };
  });
}

export async function revokeRefreshToken(
  presentedToken: string,
  allDevices: boolean,
): Promise<void> {
  const tokenHash = hashRefreshToken(presentedToken);
  const existing = await refreshTokenRepository.findByTokenHashWithUser(prisma, tokenHash);

  if (!existing) {
    return;
  }

  if (allDevices) {
    await refreshTokenRepository.revokeAllActiveForUser(prisma, existing.userId);
    return;
  }

  await refreshTokenRepository.revokeById(prisma, existing.id);
}

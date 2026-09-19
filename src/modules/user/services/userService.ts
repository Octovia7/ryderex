import type { DriverLicenseStatus } from '../../../generated/prisma/enums';
import { documentProvider, toSignedDocumentUrl } from '../../../infrastructure/cloudinary';
import { prisma } from '../../../infrastructure/database/prismaClient';
import { getUniqueConstraintFields } from '../../../infrastructure/database/prismaErrors';
import { AppError } from '../../../shared/AppError';
import * as userDocumentRepository from '../repositories/userDocumentRepository';
import * as userRepository from '../repositories/userRepository';
import type { UpdateProfileData } from '../repositories/userRepository';

interface RepositoryUser {
  id: string;
  email: string;
  phone: string;
  name: string;
  profileImageUrl: string | null;
  role: string;
  status: string;
  driverRatingAverage: unknown;
  driverRatingCount: number;
  passengerRatingAverage: unknown;
  passengerRatingCount: number;
  driverLicenseStatus: string | null;
  driverLicenseRejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserDto {
  id: string;
  email: string;
  phone: string;
  name: string;
  profileImageUrl: string | null;
  role: string;
  status: string;
  driverRatingAverage: number | null;
  driverRatingCount: number;
  passengerRatingAverage: number | null;
  passengerRatingCount: number;
  driverLicenseStatus: string | null;
  driverLicenseRejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Repositories return Prisma.Decimal for money/rating columns; the mapping
// boundary converts to plain numbers so nothing downstream (including JSON
// serialization) has to know about the Decimal type.
function toUserDto(user: RepositoryUser): UserDto {
  return {
    ...user,
    driverRatingAverage:
      user.driverRatingAverage === null ? null : Number(user.driverRatingAverage),
    passengerRatingAverage:
      user.passengerRatingAverage === null ? null : Number(user.passengerRatingAverage),
  };
}

export async function findByEmail(email: string): Promise<UserDto | null> {
  const user = await userRepository.findByEmail(email);
  return user ? toUserDto(user) : null;
}

export async function getProfile(id: string): Promise<UserDto> {
  const user = await userRepository.findById(id);

  if (!user) {
    throw new AppError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
  }

  return toUserDto(user);
}

function mapUniqueConstraintError(error: unknown): never {
  const fields = getUniqueConstraintFields(error);

  if (fields?.includes('email')) {
    throw new AppError({
      statusCode: 409,
      code: 'EMAIL_ALREADY_IN_USE',
      message: 'An account with this email already exists.',
      cause: error,
    });
  }

  if (fields?.includes('phone')) {
    throw new AppError({
      statusCode: 409,
      code: 'PHONE_ALREADY_IN_USE',
      message: 'An account with this phone number already exists.',
      cause: error,
    });
  }

  throw error;
}

export async function createPassenger(data: {
  email: string;
  name: string;
  phone: string;
}): Promise<UserDto> {
  try {
    const user = await userRepository.createPassenger(data);
    return toUserDto(user);
  } catch (error) {
    mapUniqueConstraintError(error);
  }
}

export async function updateProfile(id: string, data: UpdateProfileData): Promise<UserDto> {
  try {
    const user = await userRepository.updateProfile(id, data);
    return toUserDto(user);
  } catch (error) {
    mapUniqueConstraintError(error);
  }
}

// External call (Cloudinary upload) happens before any database write, and
// never inside the transaction below. The two internal writes (document row
// + status flip) then commit together — the conditional UPDATE, not this
// pre-check, is what decides correctness, so a genuine concurrent
// resubmission still can't create two PENDING applications.
//
// The pre-check itself only exists to avoid wasting an upload on the common
// case (resubmitting while obviously already PENDING) — it is not a
// correctness guard, so a race that slips past it and uploads anyway leaves
// an orphaned Cloudinary asset with no corresponding row. No compensating
// delete is implemented: the documented DocumentProvider interface has
// exactly two methods (uploadDocument, getSignedUrl), and no cleanup call
// for any provider is ever described in the docs — the same accepted
// trade-off already made for Payment/Ride's own external-call orphans
// (architecture.md §11, §20: "an orphan order exists... no money moves
// either way"). Adding a delete method here would be inventing an
// architecture the docs don't specify.
export async function submitDriverApplication(
  userId: string,
  file: { buffer: Buffer },
): Promise<void> {
  const existing = await userRepository.findById(userId);

  if (existing?.driverLicenseStatus === 'PENDING') {
    throw new AppError({
      statusCode: 409,
      code: 'DRIVER_APPLICATION_PENDING',
      message: 'A driver application is already pending for this account.',
    });
  }

  const folder = `users/${userId}/driver-license`;
  const { publicId } = await documentProvider.uploadDocument({ buffer: file.buffer, folder });

  const applied = await prisma.$transaction(async (tx) => {
    const updated = await userRepository.markDriverApplicationPending(tx, userId);

    if (!updated) {
      return false;
    }

    await userDocumentRepository.create(tx, {
      userId,
      documentType: 'DRIVER_LICENSE',
      cloudinaryPublicId: publicId,
    });

    return true;
  });

  if (!applied) {
    throw new AppError({
      statusCode: 409,
      code: 'DRIVER_APPLICATION_PENDING',
      message: 'A driver application is already pending for this account.',
    });
  }
}

export interface DriverApplicationDto {
  userId: string;
  name: string;
  email: string;
  phone: string;
  driverLicenseStatus: string;
  driverLicenseRejectionReason: string | null;
  submittedAt: Date;
  document: { id: string; url: string } | null;
}

export async function listDriverApplications(
  status: DriverLicenseStatus,
): Promise<DriverApplicationDto[]> {
  const users = await userRepository.findDriverApplicationsByStatus(status);

  return users.map((user) => {
    const document = user.documents[0];

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      driverLicenseStatus: user.driverLicenseStatus as string,
      driverLicenseRejectionReason: user.driverLicenseRejectionReason,
      submittedAt: user.createdAt,
      document: document
        ? { id: document.id, url: toSignedDocumentUrl(document.cloudinaryPublicId) }
        : null,
    };
  });
}

export async function verifyDriverLicense(userId: string, adminId: string): Promise<void> {
  const user = await userRepository.findById(userId);

  if (!user) {
    throw new AppError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
  }

  const verified = await userRepository.verifyDriverLicense(userId, adminId);

  if (!verified) {
    throw new AppError({
      statusCode: 409,
      code: 'DRIVER_APPLICATION_NOT_PENDING',
      message: 'This driver application is not pending.',
    });
  }
}

export async function rejectDriverLicense(
  userId: string,
  adminId: string,
  reason: string,
): Promise<void> {
  const user = await userRepository.findById(userId);

  if (!user) {
    throw new AppError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
  }

  const rejected = await userRepository.rejectDriverLicense(userId, adminId, reason);

  if (!rejected) {
    throw new AppError({
      statusCode: 409,
      code: 'DRIVER_APPLICATION_NOT_PENDING',
      message: 'This driver application is not pending.',
    });
  }
}

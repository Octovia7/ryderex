import { getUniqueConstraintFields } from '../../../infrastructure/database/prismaErrors';
import { AppError } from '../../../shared/AppError';
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

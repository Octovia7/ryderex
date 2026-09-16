import { getUniqueConstraintFields } from '../../../infrastructure/database/prismaErrors';
import { AppError } from '../../../shared/AppError';
import * as userRepository from '../repositories/userRepository';

export function findByEmail(email: string) {
  return userRepository.findByEmail(email);
}

export async function createPassenger(data: { email: string; name: string; phone: string }) {
  try {
    return await userRepository.createPassenger(data);
  } catch (error) {
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
}

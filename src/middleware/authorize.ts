import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../shared/AppError';

// Used sparingly — only where an entire capability belongs to a role.
// Resource-level ownership checks live in services, not here.
export function authorize(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      next(
        new AppError({
          statusCode: 403,
          code: 'FORBIDDEN',
          message: 'You do not have permission to perform this action.',
        }),
      );
      return;
    }

    next();
  };
}

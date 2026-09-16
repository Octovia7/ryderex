import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../shared/AppError';

// Every `:id` route needs this — ids are Postgres @db.Uuid, so an
// unvalidated malformed id reaches the driver as a raw 500 instead of 400.
export function validateParams<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue && issue.path.length > 0 ? issue.path.join('.') : 'params';

      next(
        new AppError({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: `Invalid value for '${field}': ${issue?.message ?? 'validation failed'}`,
          cause: result.error.flatten(),
        }),
      );
      return;
    }

    req.params = result.data as typeof req.params;
    next();
  };
}

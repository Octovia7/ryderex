import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../shared/AppError';

export function validateBody<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue && issue.path.length > 0 ? issue.path.join('.') : 'body';

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

    req.body = result.data;
    next();
  };
}

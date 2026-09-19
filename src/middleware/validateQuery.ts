import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../shared/AppError';

declare module 'express-serve-static-core' {
  interface Request {
    validatedQuery?: unknown;
  }
}

// Express 5 makes `req.query` getter-only, so validated/coerced query
// results go on `req.validatedQuery` instead of reassigning `req.query`.
export function validateQuery<T>(schema: ZodType<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);

    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue && issue.path.length > 0 ? issue.path.join('.') : 'query';

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

    req.validatedQuery = result.data;
    next();
  };
}

import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../shared/AppError';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(
    new AppError({
      statusCode: 404,
      code: 'ROUTE_NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} was not found.`,
    }),
  );
}

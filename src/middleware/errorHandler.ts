import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError';

// Express recognizes error-handling middleware by its four-argument arity,
// so all four parameters must stay declared even though some are unused.
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      console.error(`[error] ${error.code}: ${error.message}`, error.cause ?? '');
    }

    res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }

  console.error('[error] UNEXPECTED_ERROR', error);

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    },
  });
}

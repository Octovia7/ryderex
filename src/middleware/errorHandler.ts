import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../shared/AppError';

// Express recognizes error-handling middleware by its four-argument arity,
// so all four parameters must stay declared even though some are unused.
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    if (error.statusCode >= 500) {
      console.error(`[error] ${req.requestId} ${error.code}: ${error.message}`, error.cause ?? '');
    }

    res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
      },
      requestId: req.requestId,
    });
    return;
  }

  console.error(`[error] ${req.requestId} INTERNAL_ERROR`, error);

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong',
    },
    requestId: req.requestId,
  });
}

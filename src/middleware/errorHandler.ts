import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { AppError } from '../shared/AppError';

function respond(
  req: Request,
  res: Response,
  statusCode: number,
  code: string,
  message: string,
): void {
  res.status(statusCode).json({
    success: false,
    error: { code, message },
    requestId: req.requestId,
  });
}

function isBodyParserError(error: unknown): error is { type: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    typeof (error as { type: unknown }).type === 'string'
  );
}

function has4xxStatus(error: unknown): error is { status?: number; statusCode?: number } {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const status =
    (error as { status?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' && status >= 400 && status < 500;
}

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

    respond(req, res, error.statusCode, error.code, error.message);
    return;
  }

  // Normalizes non-AppError throws that already carry a correct status of
  // their own — otherwise a malformed body, an over-large upload, or an
  // over-large request all surface as a generic 500 instead of the caller's
  // own mistake.
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      respond(req, res, 413, 'FILE_TOO_LARGE', 'The uploaded file is too large.');
      return;
    }
    respond(req, res, 400, 'INVALID_UPLOAD', 'The upload could not be processed.');
    return;
  }

  if (isBodyParserError(error)) {
    if (error.type === 'entity.parse.failed') {
      respond(req, res, 400, 'INVALID_JSON', 'The request body is not valid JSON.');
      return;
    }
    if (error.type === 'entity.too.large') {
      respond(req, res, 413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
      return;
    }
  }

  if (has4xxStatus(error)) {
    const status = (error.status ?? error.statusCode) as number;
    respond(req, res, status, 'BAD_REQUEST', 'The request could not be processed.');
    return;
  }

  console.error(`[error] ${req.requestId} INTERNAL_ERROR`, error);
  respond(req, res, 500, 'INTERNAL_ERROR', 'Something went wrong');
}

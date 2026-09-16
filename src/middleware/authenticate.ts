import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../modules/auth/services/tokenService';
import { AppError } from '../shared/AppError';

declare module 'express-serve-static-core' {
  interface Request {
    user?: { id: string; role: string };
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('Authorization');

  if (!header || !header.startsWith('Bearer ')) {
    next(
      new AppError({
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid Authorization header.',
      }),
    );
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  const payload = verifyAccessToken(token);

  req.user = { id: payload.sub, role: payload.role };
  next();
}

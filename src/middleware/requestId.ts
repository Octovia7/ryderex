import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

// Honours an inbound X-Request-Id (useful behind a proxy/load balancer that
// already assigns one), otherwise mints a fresh one. Echoed as a response
// header on every response, and inside the body of every error response.
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header('X-Request-Id');
  const id = inbound && inbound.trim().length > 0 ? inbound.trim() : `req_${randomUUID()}`;

  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

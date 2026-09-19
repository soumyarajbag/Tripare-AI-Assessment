import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

/**
 * Attaches a correlationId to every request.
 * Honours X-Correlation-Id header from upstream callers; generates a UUID otherwise.
 * The id is echoed back in the response header.
 */
export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers['x-correlation-id'];
  req.correlationId = typeof incoming === 'string' ? incoming : uuidv4();
  res.setHeader('X-Correlation-Id', req.correlationId);
  next();
}

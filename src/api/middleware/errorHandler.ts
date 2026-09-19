import { type NextFunction, type Request, type Response } from 'express';
import { logger } from '../../infrastructure/logger';
import { HttpError } from '../errors/httpError';

/**
 * Global error handler — must be registered LAST in the Express middleware chain.
 * Catches HttpError instances and unknown errors, returning structured JSON.
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const correlationId = req.correlationId;

  if (err instanceof HttpError) {
    logger.warn({
      msg: 'HTTP error',
      correlationId,
      statusCode: err.statusCode,
      error: err.message,
      code: err.code,
    });

    res.status(err.statusCode).json({
      error: err.message,
      code: err.code ?? 'HTTP_ERROR',
      correlationId,
    });
    return;
  }

  // Unknown error — log full stack and return 500
  logger.error({
    msg: 'Unhandled error',
    correlationId,
    error: err.message,
    stack: err.stack,
  });

  res.status(500).json({
    error: 'An unexpected error occurred',
    code: 'INTERNAL_SERVER_ERROR',
    correlationId,
  });
}

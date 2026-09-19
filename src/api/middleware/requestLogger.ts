import { Request, Response, NextFunction } from 'express';
import { logger } from '../../infrastructure/logger';

/**
 * Structured request/response logger using pino.
 * Logs request on receipt and response after completion.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  logger.info({
    msg: 'Request received',
    correlationId: req.correlationId,
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip,
  });

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level]({
      msg: 'Response sent',
      correlationId: req.correlationId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
}

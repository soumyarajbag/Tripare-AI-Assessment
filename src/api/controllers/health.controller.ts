import { type RequestHandler } from 'express';
import { getHealthStatus } from '../../services/health.service';
import { logger } from '../../infrastructure/logger';

/** Handles GET /health and maps dependency health to an HTTP status. */
export const getHealth: RequestHandler = async (_req, res) => {
  try {
    const health = await getHealthStatus();
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 207 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    logger.error({
      msg: 'Health check failed',
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check threw an unexpected error',
    });
  }
};

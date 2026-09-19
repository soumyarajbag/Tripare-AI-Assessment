import express from 'express';
import { correlationIdMiddleware } from './middleware/correlationId';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import hotelsRouter from './routes/hotels.route';
import healthRouter from './routes/health.route';
import supplierARouter from './routes/supplierA.route';
import supplierBRouter from './routes/supplierB.route';

export function createApp(): express.Application {
  const app = express();

  // ── Global middleware ─────────────────────────────────────────────────────
  app.use(express.json());
  app.use(correlationIdMiddleware);
  app.use(requestLogger);

  // ── Routes ────────────────────────────────────────────────────────────────
  app.use('/api/hotels', hotelsRouter);
  app.use('/health', healthRouter);
  app.use('/supplierA', supplierARouter);
  app.use('/supplierB', supplierBRouter);

  // ── 404 handler ───────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({ error: 'Route not found', code: 'NOT_FOUND' });
  });

  // ── Global error handler (must be last) ───────────────────────────────────
  app.use(errorHandler);

  return app;
}

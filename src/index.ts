import { env } from './config/env';
import { logger } from './infrastructure/logger';

/**
 * Entry point — controlled by ROLE environment variable:
 *   ROLE=api    (default) → starts Express HTTP server
 *   ROLE=worker           → starts Temporal Worker
 *
 * This allows the same Docker image to serve both roles,
 * keeping the codebase DRY while enabling independent scaling.
 */

async function runServer(): Promise<void> {
  // Import lazily to avoid pulling in server deps into the worker process
  const { createApp } = await import('./api/server');
  const { getRedisClient } = await import('./services/redis.service');
  const { getTemporalClient } = await import('./temporal/client');

  // Pre-warm connections
  getRedisClient();
  await getTemporalClient();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({
      msg: '🚀 Hotel Offer Orchestrator API started',
      port: env.PORT,
      env: env.NODE_ENV,
      role: 'api',
    });
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ msg: `Received ${signal} — shutting down gracefully` });
    server.close(async () => {
      const { closeRedis } = await import('./services/redis.service');
      const { closeTemporalClient } = await import('./temporal/client');
      await Promise.allSettled([closeRedis(), closeTemporalClient()]);
      logger.info({ msg: 'Graceful shutdown complete' });
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

async function runWorker(): Promise<void> {
  const { runWorker: startWorker } = await import('./temporal/worker');
  logger.info({ msg: '⚙️  Hotel Offer Orchestrator Worker starting', role: 'worker' });
  await startWorker();
}

// ── Boot ──────────────────────────────────────────────────────────────────────
const role = env.ROLE;

if (role === 'worker') {
  runWorker().catch((err: unknown) => {
    logger.error({ msg: 'Worker fatal error', error: (err as Error).message });
    process.exit(1);
  });
} else {
  runServer().catch((err: unknown) => {
    logger.error({ msg: 'Server fatal error', error: (err as Error).message });
    process.exit(1);
  });
}

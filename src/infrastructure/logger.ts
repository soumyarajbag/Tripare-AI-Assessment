import pino from 'pino';
import { env } from '../config/env';

/** Shared structured logger used across HTTP, application, and worker layers. */
export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport:
    env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
});

import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  ROLE: z.enum(['api', 'worker']).default('api'),

  // Temporal
  TEMPORAL_ADDRESS: z.string().default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().default('default'),
  TEMPORAL_TASK_QUEUE: z.string().default('hotel-offer-queue'),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_CACHE_TTL_SECONDS: z.coerce.number().default(300), // 5 minutes

  // Supplier base URLs (point to self since mocks are embedded)
  SUPPLIER_A_BASE_URL: z.string().default('http://localhost:3000'),
  SUPPLIER_B_BASE_URL: z.string().default('http://localhost:3000'),

  // Resilience
  ALLOW_STALE_CACHE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  SUPPLIER_REQUEST_TIMEOUT_MS: z.coerce.number().default(5000),
  HEALTH_PROBE_TIMEOUT_MS: z.coerce.number().default(2000),
});

function parseEnv() {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();
export type Env = typeof env;

import axios from 'axios';
import { Connection } from '@temporalio/client';
import { pingRedis } from './redis.service';
import { env } from '../config/env';
import { DependencyHealth, HealthStatus } from '../domain/hotel.types';

async function probeHttp(url: string, timeoutMs: number): Promise<DependencyHealth> {
  const start = Date.now();
  try {
    await axios.get(url, { timeout: timeoutMs });
    return { status: 'up', latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      error: (err as Error).message,
    };
  }
}

async function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Probe timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function probeTemporal(timeoutMs: number): Promise<DependencyHealth> {
  const start = Date.now();
  let connection: Connection | null = null;
  try {
    connection = await Connection.connect({
      address: env.TEMPORAL_ADDRESS,
      connectTimeout: timeoutMs,
    });
    // getSystemInfo is a lightweight gRPC ping — no namespace or auth required
    await connection.withDeadline(Date.now() + timeoutMs, () =>
      connection!.workflowService.getSystemInfo({}),
    );
    return { status: 'up', latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      error: (err as Error).message,
    };
  } finally {
    if (connection) await connection.close().catch(() => undefined);
  }
}

async function probeRedis(timeoutMs: number): Promise<DependencyHealth> {
  const start = Date.now();
  try {
    await withTimeout(() => pingRedis(), timeoutMs);
    return { status: 'up', latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
      error: (err as Error).message,
    };
  }
}

/**
 * Runs all four dependency probes concurrently and aggregates into an overall status.
 * Uses Promise.allSettled so one failure never prevents others from resolving.
 */
export async function getHealthStatus(): Promise<HealthStatus> {
  const probeTimeout = env.HEALTH_PROBE_TIMEOUT_MS;

  const [supplierAResult, supplierBResult, temporalResult, redisResult] =
    await Promise.allSettled([
      probeHttp(`${env.SUPPLIER_A_BASE_URL}/supplierA/hotels?city=health-probe`, probeTimeout),
      probeHttp(`${env.SUPPLIER_B_BASE_URL}/supplierB/hotels?city=health-probe`, probeTimeout),
      probeTemporal(probeTimeout),
      probeRedis(probeTimeout),
    ]);

  const resolve = (r: PromiseSettledResult<DependencyHealth>): DependencyHealth =>
    r.status === 'fulfilled'
      ? r.value
      : { status: 'down', latencyMs: 0, error: r.reason instanceof Error ? r.reason.message : String(r.reason) };

  const deps = {
    supplierA: resolve(supplierAResult),
    supplierB: resolve(supplierBResult),
    temporal: resolve(temporalResult),
    redis: resolve(redisResult),
  };

  // Core infrastructure: Temporal + Redis being down = unhealthy
  const coreDown = deps.temporal.status === 'down' || deps.redis.status === 'down';
  const anyDown = Object.values(deps).some((d) => d.status === 'down');

  const overallStatus: HealthStatus['status'] = coreDown
    ? 'unhealthy'
    : anyDown
    ? 'degraded'
    : 'healthy';

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    dependencies: deps,
  };
}

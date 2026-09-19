import { WorkflowExecutionAlreadyStartedError, type WorkflowHandle } from '@temporalio/client';
import { v4 as uuidv4 } from 'uuid';
import { getTemporalClient } from '../temporal/client';
import { HotelAggregatorWorkflow } from '../temporal/workflows/hotelAggregator.workflow';
import { readFromCache, writeToCache, readAllFromCache } from './redis.service';
import { Hotel, HotelQueryParams, CacheMeta } from '../domain/hotel.types';
import { env } from '../config/env';
import { logger } from '../infrastructure/logger';

export interface AggregationResult {
  hotels: Hotel[];
  cacheHit: boolean;
  stale: boolean;
  temporalRunId?: string;
  correlationId: string;
}

/**
 * Core orchestration service.
 *
 * Flow:
 *  1. Check Redis cache (with optional price filter via ZRANGEBYSCORE)
 *  2. Cache hit  → return immediately
 *  3. Cache miss → start/join Temporal workflow → write result to Redis → re-query with filter
 *  4. If workflow fails and stale cache exists → return stale data (if ALLOW_STALE_CACHE=true)
 *  5. If everything fails → throw so the route can return 503
 */
export async function aggregateHotels(
  params: HotelQueryParams,
  correlationId: string = uuidv4(),
): Promise<AggregationResult> {
  const { city, minPrice, maxPrice } = params;

  // ── Step 1: Redis cache lookup ──────────────────────────────────────────────
  const cached = await readFromCache(city, minPrice, maxPrice);
  if (cached !== null) {
    logger.info({ msg: 'Cache HIT', city, correlationId, count: cached.length });
    return { hotels: cached, cacheHit: true, stale: false, correlationId };
  }

  logger.info({ msg: 'Cache MISS — invoking Temporal workflow', city, correlationId });

  // ── Step 2: Execute Temporal workflow (single-flight via deterministic workflowId) ──
  // Deterministic workflowId prevents stampede: only one execution per city at a time
  const workflowId = `hotel-aggregator-${city.toLowerCase()}`;
  let runId: string | undefined;

  try {
    const client = await getTemporalClient();
    let handle: WorkflowHandle<typeof HotelAggregatorWorkflow>;
    try {
      const startedHandle = await client.workflow.start(HotelAggregatorWorkflow, {
        taskQueue: env.TEMPORAL_TASK_QUEUE,
        workflowId,
        args: [{ city, correlationId }],
      });
      handle = startedHandle;
      runId = startedHandle.firstExecutionRunId;
      logger.info({ msg: 'Temporal workflow started', city, correlationId, workflowId, runId });
    } catch (err) {
      if (err instanceof WorkflowExecutionAlreadyStartedError) {
        // Another concurrent request already started the workflow — join it
        handle = client.workflow.getHandle<typeof HotelAggregatorWorkflow>(workflowId);
        logger.info({ msg: 'Temporal workflow already running — joining', city, correlationId, workflowId });
      } else {
        throw err;
      }
    }

    const hotels: Hotel[] = await handle.result();

    // ── Step 3: Write full result to Redis ─────────────────────────────────────
    const meta: CacheMeta = {
      cachedAt: new Date().toISOString(),
      workflowRunId: runId ?? 'unknown',
      totalCount: hotels.length,
    };
    await writeToCache(city, hotels, meta);

    // ── Step 4: Re-query Redis with price filter applied in Redis ───────────────
    const filtered = await readFromCache(city, minPrice, maxPrice);
    const finalHotels = filtered ?? hotels.filter((h) => {
      if (minPrice !== undefined && h.price < minPrice) return false;
      if (maxPrice !== undefined && h.price > maxPrice) return false;
      return true;
    });

    return { hotels: finalHotels, cacheHit: false, stale: false, temporalRunId: runId, correlationId };
  } catch (workflowErr) {
    logger.error({
      msg: 'Temporal workflow failed',
      city,
      correlationId,
      error: (workflowErr as Error).message,
    });

    // ── Step 5: Stale cache fallback ───────────────────────────────────────────
    if (env.ALLOW_STALE_CACHE) {
      const staleResult = await readAllFromCache(city);
      if (staleResult) {
        logger.warn({ msg: 'Serving stale cache — workflow failed', city, correlationId });
        // Apply price filter in JS on stale data
        const staleFiltered = staleResult.hotels.filter((h) => {
          if (minPrice !== undefined && h.price < minPrice) return false;
          if (maxPrice !== undefined && h.price > maxPrice) return false;
          return true;
        });
        return {
          hotels: staleFiltered,
          cacheHit: false,
          stale: true,
          correlationId,
        };
      }
    }

    throw workflowErr;
  }
}

/**
 * HotelAggregatorWorkflow
 *
 * Temporal Workflow — IMPORTANT CONSTRAINTS:
 *  - No direct I/O (no axios, no redis, no console.log with Date)
 *  - All side effects go through proxyActivities
 *  - Pure deterministic business logic is allowed inline
 *
 * Execution:
 *  1. Fan-out: call Supplier A and Supplier B activities in parallel
 *  2. Each activity returns validated hotels or rejects after its retries
 *  3. Deduplicate by hotel name, select cheaper price when both carry the same hotel
 *  4. Return sorted result to the caller (Express API)
 */

import { proxyActivities, log } from '@temporalio/workflow';
import type * as ActivitiesType from '../activities/supplierActivities';
import { deduplicateAndSelectBest } from '../../domain/deduplication';
import { Hotel, SupplierHotel, WorkflowInput } from '../../domain/hotel.types';

// Proxy activities — these become Temporal-managed async calls inside the workflow
const { fetchFromSupplierA, fetchFromSupplierB } = proxyActivities<typeof ActivitiesType>({
  startToCloseTimeout: '15s',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '10s',
    nonRetryableErrorTypes: ['SupplierDataValidationError', 'SupplierHttpError'],
  },
});

export async function HotelAggregatorWorkflow(input: WorkflowInput): Promise<Hotel[]> {
  const { city, correlationId } = input;

  log.info('HotelAggregatorWorkflow: started', { city, correlationId });

  // Fan-out: both supplier activities run concurrently as separate Temporal ActivityTasks
  const [resultA, resultB] = await Promise.allSettled([
    fetchFromSupplierA(city, correlationId),
    fetchFromSupplierB(city, correlationId),
  ]);

  const hotelsA: SupplierHotel[] = resultA.status === 'fulfilled' ? resultA.value : [];
  const hotelsB: SupplierHotel[] = resultB.status === 'fulfilled' ? resultB.value : [];

  if (resultA.status === 'rejected') {
    log.warn('HotelAggregatorWorkflow: Supplier A failed, continuing with B only', {
      city,
      correlationId,
      error: resultA.reason instanceof Error ? resultA.reason.message : String(resultA.reason),
    });
  }

  if (resultB.status === 'rejected') {
    log.warn('HotelAggregatorWorkflow: Supplier B failed, continuing with A only', {
      city,
      correlationId,
      error: resultB.reason instanceof Error ? resultB.reason.message : String(resultB.reason),
    });
  }

  if (hotelsA.length === 0 && hotelsB.length === 0) {
    if (resultA.status === 'rejected' && resultB.status === 'rejected') {
      log.error('HotelAggregatorWorkflow: both suppliers failed', { city, correlationId });
      throw new Error(`Both suppliers failed for city=${city}`);
    }

    log.error('HotelAggregatorWorkflow: both suppliers returned no data', { city, correlationId });
    // Return empty — let the service layer decide how to handle (stale cache / 404)
    return [];
  }

  // Pure deterministic logic — safe inside Temporal
  const dedupedHotels = deduplicateAndSelectBest(hotelsA, hotelsB);

  log.info('HotelAggregatorWorkflow: completed', {
    city,
    correlationId,
    totalFromA: hotelsA.length,
    totalFromB: hotelsB.length,
    dedupedCount: dedupedHotels.length,
  });

  return dedupedHotels;
}

// ─── Domain Types ─────────────────────────────────────────────────────────────

/** Raw hotel shape returned by a supplier endpoint */
export interface SupplierHotel {
  hotelId: string;
  name: string;
  price: number;
  city: string;
  commissionPct: number;
}

/** Normalised hotel returned by the aggregation API */
export interface Hotel {
  name: string;
  price: number;
  supplier: string;
  commissionPct: number;
}

/** Input payload carried into the Temporal Workflow */
export interface WorkflowInput {
  city: string;
  correlationId: string;
}

/** Shape returned by each activity */
export interface ActivityResult {
  hotels: SupplierHotel[];
  supplierName: string;
}

/** Validated query params for GET /api/hotels */
export interface HotelQueryParams {
  city: string;
  minPrice?: number;
  maxPrice?: number;
}

/** Per-dependency health status */
export interface DependencyHealth {
  status: 'up' | 'down';
  latencyMs: number;
  error?: string;
}

/** Overall health response */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  dependencies: {
    supplierA: DependencyHealth;
    supplierB: DependencyHealth;
    temporal: DependencyHealth;
    redis: DependencyHealth;
  };
}

/** Cached metadata stored alongside hotel ZSET */
export interface CacheMeta {
  cachedAt: string;
  workflowRunId: string;
  totalCount: number;
}

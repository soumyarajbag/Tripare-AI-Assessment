# 🏨 Hotel Offer Orchestrator — Technical Approach

> **Stack:** Node.js (TypeScript) · Express · Temporal.io · Redis · Docker Compose

---

## Table of Contents

1. [Problem Decomposition](#1-problem-decomposition)
2. [Architecture Overview](#2-architecture-overview)
3. [Why This Architecture Stands Out](#3-why-this-architecture-stands-out)
4. [Component Deep-Dive](#4-component-deep-dive)
5. [Data Flow: Request Lifecycle](#5-data-flow-request-lifecycle)
6. [Deduplication & Best-Price Selection Logic](#6-deduplication--best-price-selection-logic)
7. [Redis Caching & Price Filtering Strategy](#7-redis-caching--price-filtering-strategy)
8. [Error Handling & Resilience](#8-error-handling--resilience)
9. [Project Structure](#9-project-structure)
10. [Docker Compose Topology](#10-docker-compose-topology)
11. [API Contract](#11-api-contract)
12. [Postman Collection Strategy](#12-postman-collection-strategy)
13. [Edge Cases Handled](#13-edge-cases-handled)
14. [What Makes This Different](#14-what-makes-this-different)

---

## 1. Problem Decomposition

The system must solve four distinct concerns simultaneously:

| Concern | Naive Approach | Our Approach |
|---|---|---|
| Fan-out to two suppliers | Sequential HTTP calls | Temporal parallel activities |
| Deduplication & best-price | In-memory JS reduce | Deterministic workflow logic inside Temporal (replayable) |
| Price-range filtering | Filter in Node.js memory | Redis Sorted Set `ZRANGEBYSCORE` (O(log N + M), where M is the number of returned hotels) |
| Supplier failures | Crash the entire request | Temporal retry policies + graceful degradation |

---

## 2. Architecture Overview

```
+-------------------------------------------------------------------------+
|                          Docker Compose Network                          |
|                                                                         |
|  +--------------+    +------------------------------------------------+ |
|  |   Client /   |    |               Express API Server               | |
|  |   Postman    +---->  GET /api/hotels?city=&minPrice=&maxPrice=     | |
|  +--------------+    |  GET /health                                   | |
|                      |  GET /supplierA/hotels                         | |
|                      |  GET /supplierB/hotels                         | |
|                      +-------------------+----------------------------+ |
|                                          | Temporal Client              |
|                                          v                              |
|                      +------------------------------+                  |
|                      |      Temporal Server         |                  |
|                      |  (temporalio/auto-setup)     |                  |
|                      |                              |                  |
|                      |  +---------------------------+                  |
|                      |  | HotelAggregatorWorkflow   |                  |
|                      |  |                           |                  |
|                      |  |  +--------+ +----------+  |                  |
|                      |  |  | Act A  | |  Act B   |  |  (parallel)      |
|                      |  |  | fetchA | |  fetchB  |  |                  |
|                      |  |  +--------+ +----------+  |                  |
|                      |  |       v merge & dedupe v   |                  |
|                      |  |  +------------------------+|                  |
|                      |  |  | deduplicateAndSelect   ||                  |
|                      |  |  +------------------------+|                  |
|                      |  +---------------------------+|                  |
|                      +------------------------------+                  |
|                                          | result                       |
|                                          v                              |
|                      +------------------------------+                  |
|                      |         Redis 7              |                  |
|                      |  ZSET  hotel:{city}:prices   |                  |
|                      |  (member=JSON, score=price)  |                  |
|                      |  HASH hotel:{city}:meta      |                  |
|                      +------------------------------+                  |
|                                                                         |
+-------------------------------------------------------------------------+
```

**Two application roles use the same Docker image:**
1. `api` — Express HTTP server with Temporal and Redis clients
2. `worker` — Temporal Worker that runs Activities and Workflow code

Both roles share the same codebase and are selected by the `ROLE` environment variable.

---

## 3. Why This Architecture Stands Out

Most candidates solving this problem will:
- Make two `axios.get()` calls inline in the Express handler
- Run a simple `Array.reduce()` in the route handler
- Optionally add a Redis `SET` with a JSON blob

**This system is different because:**

### True Temporal Orchestration (not just a wrapper)

The deduplication and best-price selection logic lives **inside the Temporal Workflow**, not in the Express handler. This means:
- It is **replayable** — Temporal can replay history after crashes
- It is **auditable** — every run is visible in the Temporal UI with full event history
- It is **retryable at the activity level** — if Supplier A is down, only that activity retries

### Redis Sorted Set for O(log N + M) Price Filtering

Each hotel is stored as a member in a Redis **Sorted Set** with `score = price`. Price filtering uses `ZRANGEBYSCORE hotel:{city}:prices min max`; the command costs O(log N + M), where M is the number of matching results. The regular cache path does not deserialize and filter the full list in JavaScript.

### Graceful Supplier Degradation

If one supplier is unavailable, the workflow continues with the other. The health check reports each supplier's status independently. Responses are tagged with which supplier won so the client knows the data provenance.

### Structured Logging with Correlation IDs

Every request gets a `correlationId` (UUID). It is passed through the Express handler, Temporal workflow, and supplier activities. Request and workflow logs include it; infrastructure logs include it when the calling layer provides it.

### Cache Stampede Prevention (Single-Flight Pattern)

Concurrent cold-cache requests for the same city try to start the same deterministic workflow ID. Requests that find it already running join that execution with `getHandle()`. Once the workflow result is written to Redis, subsequent requests are served from cache.

---

## 4. Component Deep-Dive

### 4.1 Mock Supplier Layer

Both mock suppliers are Express sub-routers on the same server (simulating external APIs):

```
GET /supplierA/hotels?city=delhi  ->  SupplierARouter
GET /supplierB/hotels?city=delhi  ->  SupplierBRouter
```

**Static dataset with intentional overlaps:**

The mock inventory has been expanded to 20 offers per supplier for Delhi, 15 for Mumbai, and 10 for Bangalore. It includes both shared hotel names at different prices and supplier-only listings; the examples below show the original Delhi cases used in the API documentation.

| Hotel Name   | Supplier A Price | Supplier B Price | Expected Winner       |
|---|---|---|---|
| Holtin       | 6000             | 5340             | **Supplier B**        |
| Radison      | 5900             | 6400             | **Supplier A**        |
| Lemon Tree   | 4200             | —                | **Supplier A** (only) |
| The Lalit    | —                | 8100             | **Supplier B** (only) |
| Taj Palace   | 12000            | 11500            | **Supplier B**        |

City filtering is applied in the mock: only hotels matching `?city=` are returned.

**Simulating supplier failure:** A direct request to either mock endpoint with `X-Simulate-Down: true` returns HTTP 503 for Postman/manual checks. The Temporal activities do not forward this header; real HTTP 5xx, network, and timeout failures are retried with exponential backoff.

### 4.2 Temporal Workflow & Activities

#### Workflow: `HotelAggregatorWorkflow`

```typescript
// Simplified pseudocode matching the implemented workflow
export async function HotelAggregatorWorkflow(input: WorkflowInput): Promise<Hotel[]> {
  const [resultA, resultB] = await Promise.allSettled([
    fetchFromSupplierA(input.city, input.correlationId),
    fetchFromSupplierB(input.city, input.correlationId),
  ]);

  const hotelsA = resultA.status === 'fulfilled' ? resultA.value : [];
  const hotelsB = resultB.status === 'fulfilled' ? resultB.value : [];
  if (resultA.status === 'rejected' && resultB.status === 'rejected') {
    throw new Error('Both suppliers failed');
  }

  return deduplicateAndSelectBest(hotelsA, hotelsB);
}
```

Both activities are scheduled concurrently by Temporal. `Promise.allSettled` waits for both outcomes so one supplier can fail after retries while the workflow still returns the other supplier's listings. If both activities fail, the workflow fails and the API can use a stale Redis snapshot when enabled.

#### Activities

| Activity           | Responsibility                              | Retry Policy                              |
|---|---|---|
| `fetchFromSupplierA` | HTTP GET to `/supplierA/hotels?city=X`    | 3 attempts, 1s initial interval, 2x backoff |
| `fetchFromSupplierB` | HTTP GET to `/supplierB/hotels?city=X`    | 3 attempts, 1s initial interval, 2x backoff |

Activities are **pure side-effectful functions** — they do the I/O; the workflow does the logic.

#### Activity Retry Configuration

```typescript
const activities = proxyActivities<typeof activitiesImpl>({
  startToCloseTimeout: '15s',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '10s',
    nonRetryableErrorTypes: ['SupplierDataValidationError', 'SupplierHttpError'],
  },
});
```

The activity HTTP request timeout defaults to 5 seconds; Temporal allows up to 15 seconds per activity attempt. Network errors, timeouts, and supplier 5xx responses are retried up to three attempts. Malformed supplier data and other supplier 4xx responses are non-retryable.

### 4.3 Redis Caching & Filtering Strategy

#### Data Structure Choice: Sorted Set

```
Key:    hotel:{city}:prices
Type:   Sorted Set (ZSET)
Member: JSON.stringify(hotel)  <- full hotel object
Score:  hotel.price            <- used for range queries
TTL:    5 minutes (300s)       <- applied to current prices and metadata keys
Stale:  hotel:{city}:stale:*   <- snapshot retained for up to 24 hours
```

**Why Sorted Set over a plain JSON string?**
- `ZRANGEBYSCORE hotel:delhi:prices 4000 8000` retrieves only hotels in range — **no JS filtering, no full-array deserialization**
- The implementation reads results with `ZRANGEBYSCORE`, using `-inf` and `+inf` when no price bounds are supplied
- Price range queries are O(log N + M) where M = results in range

### 4.4 Express API Layer

#### Route: `GET /api/hotels`

```
1. Parse & validate query params (city required; minPrice/maxPrice optional numeric)
2. Attempt Redis cache lookup with price filter
3. On cache hit  -> return immediately with X-Cache: HIT header
4. On cache miss -> execute Temporal workflow -> write to Redis -> return with X-Cache: MISS header
5. Attach correlationId to the response header and request/workflow log context
```

**Response headers added for observability:**
- `X-Cache: HIT | MISS`
- `X-Correlation-Id: <uuid>`
- `X-Temporal-Run-Id: <runId>` (when the request starts the workflow and a run ID is available)
- `X-Data-Stale: true` (when serving the stale Redis snapshot after a workflow failure)

### 4.5 Health Check System

`GET /health` probes each dependency independently and aggregates:

```typescript
interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  dependencies: {
    supplierA: DependencyHealth;
    supplierB: DependencyHealth;
    temporal:  DependencyHealth;
    redis:     DependencyHealth;
  };
}
```

**Probe logic:**
- **Supplier A/B**: `GET /supplierA/hotels?city=health-probe` with 2s timeout
- **Temporal**: `client.connection.workflowService.getSystemInfo({})` (gRPC ping)
- **Redis**: `redis.ping()`

All four probes run via `Promise.allSettled`. Overall `status` = `healthy` if all up, `degraded` if 1-2 suppliers down, `unhealthy` if Temporal or Redis are down.

### 4.6 Observability & Logging

Using **`pino`** (structured JSON logger, ~5x faster than `winston`):

```typescript
// Request/workflow log lines carry context such as:
{
  level: 'info',
  time: 1726762084000,
  correlationId: 'c7d2e1f0-...',
  workflowId: 'hotel-aggregator-delhi',
  city: 'delhi',
  msg: 'Supplier A activity completed',
  durationMs: 42,
  hotelCount: 4
}
```

**Logging points:**
- Request received (method, path, query, correlationId)
- Cache hit/miss
- Temporal workflow started/joined
- Each activity start, success, and failure
- Redis write success
- Response sent (statusCode, durationMs)

---

## 5. Data Flow: Request Lifecycle

### Scenario A: Cache Miss (First Request)

```
Client
  |
  | GET /api/hotels?city=delhi&minPrice=4000&maxPrice=9000
  v
Express Handler
  | generate correlationId
  | validate params
  |
  +---> Redis ZRANGEBYSCORE hotel:delhi:prices 4000 9000
  |         -> key does not exist -> CACHE MISS
  |
  +---> Temporal Client: start/join workflow hotel-aggregator-delhi
  |         |
  |         +---> [Activity] fetchFromSupplierA('delhi')
  |         |         -> HTTP GET /supplierA/hotels?city=delhi -> [20 offers]
  |         |
  |         +---> [Activity] fetchFromSupplierB('delhi')  (parallel)
  |         |         -> HTTP GET /supplierB/hotels?city=delhi -> [20 offers]
  |         |
  |         -> deduplicateAndSelectBest([...A], [...B])
  |                   -> returns 24 deduplicated hotels for Delhi
  |
  +---> Redis MULTI/EXEC stores the full result in a sorted set with a 300-second TTL
  |
  +---> Redis ZRANGEBYSCORE hotel:delhi:prices 4000 9000
  |         -> returns 11 hotels matching range
  |
  -> Response 200 JSON (X-Cache: MISS, X-Correlation-Id: ...)
```

### Scenario B: Cache Hit (Subsequent Requests)

```
Client
  |
  | GET /api/hotels?city=delhi&minPrice=4000&maxPrice=9000
  v
Express Handler
  |
  +---> Redis ZRANGEBYSCORE -> CACHE HIT -> returns 11 hotels
  |
  -> Response 200 JSON (X-Cache: HIT)  <- <5ms total
```

---

## 6. Deduplication & Best-Price Selection Logic

This logic lives **inside the Temporal Workflow** (pure, deterministic function):

```typescript
function deduplicateAndSelectBest(
  suppliersA: SupplierHotel[],
  suppliersB: SupplierHotel[]
): Hotel[] {
  // Normalize hotel names: lowercase + trim (handles "holtin" vs "Holtin")
  const map = new Map<string, Hotel>();

  const process = (hotels: SupplierHotel[], supplier: string) => {
    for (const h of hotels) {
      const key = h.name.toLowerCase().trim();
      const normalized: Hotel = {
        name: h.name,
        price: h.price,
        supplier,
        commissionPct: h.commissionPct,
      };
      const existing = map.get(key);
      if (!existing || h.price < existing.price) {
        map.set(key, normalized);
      }
    }
  };

  // Process both; lower price wins on conflict
  process(suppliersA, 'Supplier A');
  process(suppliersB, 'Supplier B');

  return Array.from(map.values()).sort((a, b) => a.price - b.price);
}
```

**Edge cases handled:**
- Hotel in both suppliers -> cheaper wins, supplier field reflects winner
- Hotel in only one supplier -> that one is selected automatically
- Case-insensitive name matching (`"holtin"` == `"Holtin"`)
- Empty supplier response (supplier down) -> other supplier's data used entirely

---

## 7. Redis Caching & Price Filtering Strategy

### Key Schema

```
hotel:{city}:prices   ->  ZSET  (score=price, member=JSON hotel)
hotel:{city}:meta     ->  HASH  (cachedAt, workflowRunId, totalCount)
```

### TTL Strategy

- **5-minute TTL** on the current ZSET and metadata hash
- TTL is refreshed on every successful workflow run (not on cache hit)
- A separate stale snapshot is retained for up to 24 hours so fallback still works after the fresh cache expires
- If Redis is unavailable, the system treats the read as a cache miss, runs Temporal, and returns the filtered workflow result without caching it
- Fresh results are price-filtered in Redis; the stale-snapshot fallback applies the requested bounds in application memory

### No-Filter vs Price-Filter Queries

| Query                      | Redis Command                                     | Complexity    |
|---|---|---|
| No filter                  | `ZRANGEBYSCORE hotel:delhi:prices -inf +inf`      | O(log N + M)  |
| `minPrice=4000`            | `ZRANGEBYSCORE hotel:delhi:prices 4000 +inf`      | O(log N + M)  |
| `maxPrice=9000`            | `ZRANGEBYSCORE hotel:delhi:prices -inf 9000`      | O(log N + M)  |
| `minPrice=4000&maxPrice=9000` | `ZRANGEBYSCORE hotel:delhi:prices 4000 9000`   | O(log N + M)  |

---

## 8. Error Handling & Resilience

### Error Taxonomy

```
Temporal activity failures
  +-- Network errors, timeouts, supplier 5xx -> retried (up to 3 attempts)
  +-- Malformed supplier response            -> non-retryable
  +-- Supplier 4xx response                  -> non-retryable

HttpError (Express-layer, returned to client)
  +-- 400 BadRequest        -> invalid query params
  +-- 404 NotFound          -> unknown route
  +-- 503 ServiceUnavailable -> workflow fails and no usable stale snapshot is available
  +-- 500 InternalServerError -> unexpected error reaching the global handler
```

### Resilience Matrix

| Failure              | Impact               | Recovery                                                       |
|---|---|---|
| Supplier A down      | Partial data (B only) | Activity retries 3x -> if still down, returns B's data + warning |
| Supplier B down      | Partial data (A only) | Same as above                                                  |
| Both suppliers down  | No data              | Workflow fails -> 503; if Redis has stale data, return it with `X-Data-Stale: true` |
| Redis down           | No caching           | Temporal runs on every request; slower but correct             |
| Temporal down        | Cannot orchestrate   | A cache hit can still be served; on a miss, the API serves stale data if enabled, otherwise returns 503 |

### Stale Cache Fallback

If both suppliers fail but a stale snapshot is available in Redis, the API returns that hotel's array with `X-Data-Stale: true`. A successful response from only one supplier is treated as fresh partial data and cached for five minutes. The stale snapshot expires after 24 hours. Stale fallback is controlled by `ALLOW_STALE_CACHE=true`.

---

## 9. Project Structure

```
hotel-offer-orchestrator/
|
+-- src/
|   +-- api/
|   |   +-- controllers/                 # HTTP input validation and response mapping
|   |   +-- errors/
|   |   |   +-- httpError.ts             # Typed HTTP errors
|   |   +-- routes/
|   |   |   +-- hotels.route.ts          # GET /api/hotels
|   |   |   +-- health.route.ts          # GET /health
|   |   |   +-- supplierA.route.ts       # GET /supplierA/hotels (mock)
|   |   |   +-- supplierB.route.ts       # GET /supplierB/hotels (mock)
|   |   +-- middleware/
|   |   |   +-- correlationId.ts         # attaches X-Correlation-Id
|   |   |   +-- requestLogger.ts         # pino HTTP logger
|   |   |   +-- errorHandler.ts          # global error handler
|   |   +-- server.ts                    # Express app setup
|   |
|   +-- temporal/
|   |   +-- workflows/
|   |   |   +-- hotelAggregator.workflow.ts  # Temporal Workflow
|   |   +-- activities/
|   |   |   +-- supplierActivities.ts        # Activities: fetch and validate both suppliers
|   |   +-- worker.ts                        # Temporal Worker entry point
|   |   +-- client.ts                        # Temporal Client singleton
|   |
|   +-- services/
|   |   +-- hotelAggregator.service.ts   # orchestrates Redis + Temporal
|   |   +-- supplier.service.ts          # mock supplier adapter and latency
|   |   +-- redis.service.ts             # Redis ZSET read/write helpers
|   |   +-- health.service.ts            # dependency probe logic
|
|   +-- infrastructure/
|   |   +-- logger.ts                    # shared structured logger
|   |
|   +-- domain/
|   |   +-- hotel.types.ts               # Hotel, SupplierHotel, WorkflowInput types
|   |   +-- deduplication.ts             # pure deduplication function (shared)
|   |
|   +-- data/
|   |   +-- mockSupplierData.ts          # static hotel datasets per city/supplier
|   |
|   +-- config/
|   |   +-- env.ts                       # zod-validated env vars
|   |
|   +-- index.ts                         # entrypoint (api vs worker via ROLE env var)
|
+-- postman/
|   +-- HotelOfferOrchestrator.postman_collection.json
|
+-- docker-compose.yml
+-- Dockerfile
+-- .env.example
+-- tsconfig.json
+-- package.json
+-- README.md
```

---

## 10. Docker Compose Topology

```yaml
# docker-compose.yml (abbreviated)
services:

  temporal:           # Temporal server; UI runs in a separate container
    image: temporalio/auto-setup:1.24.2
    ports: ["7233:7233"]
    environment: [DB=postgres12, DB_PORT=5432, POSTGRES_USER=temporal, POSTGRES_PWD=temporal, POSTGRES_SEEDS=postgres]
    depends_on:
      postgres:
        condition: service_healthy

  postgres:           # persistence backend required by auto-setup
    image: postgres:16-alpine

  temporal-ui:        # Temporal Web UI
    image: temporalio/ui:2.26
    ports: ["8080:8080"]

  redis:              # Redis 7 with persistence
    image: redis:7-alpine
    ports: ["6379:6379"]
    command: redis-server --appendonly yes

  api:                # Express API + Redis client + Temporal client
    build: .
    ports: ["3000:3000"]
    environment:
      - ROLE=api
    depends_on:
      temporal:
        condition: service_healthy
      redis:
        condition: service_healthy

  worker:             # Temporal Worker process (scales independently)
    build: .
    environment:
      - ROLE=worker
    depends_on:
      temporal:
        condition: service_healthy
      redis:
        condition: service_healthy
      api:
        condition: service_started
```

**Single multi-stage `Dockerfile`, two roles:**
```dockerfile
FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

FROM node:20-bookworm-slim AS production
RUN groupadd --system appgroup && useradd --system --gid appgroup appuser
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
USER appuser
ENV NODE_ENV=production ROLE=api PORT=3000
CMD ["node", "dist/index.js"]
```

The production image runs as a non-root user and includes an API health check. Docker Compose disables that HTTP health check for the worker role.

**`src/index.ts` role detection:**
```typescript
if (process.env.ROLE === 'worker') {
  runWorker(); // starts Temporal worker
} else {
  runServer(); // starts Express server
}
```

---

## 11. API Contract

### `GET /api/hotels`

**Query Parameters:**

| Param      | Type     | Required | Description                  |
|---|---|---|---|
| `city`     | `string` | Yes      | City name (case-insensitive) |
| `minPrice` | `number` | No       | Minimum price (inclusive)    |
| `maxPrice` | `number` | No       | Maximum price (inclusive)    |

**Example response excerpt (`GET /api/hotels?city=delhi` returns 24 hotels when both suppliers are available):**
```json
[
  {
    "name": "Holtin",
    "price": 5340,
    "supplier": "Supplier B",
    "commissionPct": 20
  },
  {
    "name": "Radison",
    "price": 5900,
    "supplier": "Supplier A",
    "commissionPct": 13
  }
]
```

**Response Headers:**
```
X-Cache: HIT | MISS
X-Correlation-Id: c7d2e1f0-4a6d-4bde-afd3-657d8cce1fdc
X-Temporal-Run-Id: abc123  (when a workflow run ID is available)
X-Data-Stale: true         (only when serving stale fallback)
```

**Error Responses:**

| Status | When                                                    |
|---|---|
| `400`  | `city` missing or `minPrice`/`maxPrice` not valid numbers |
| `200`  | Both successful supplier responses contain no hotels; response is `[]` |
| `503`  | The workflow fails and no usable stale Redis snapshot can be served |
| `500`  | Unexpected internal error                               |

---

### `GET /health`

**Response `200` (all healthy):**
```json
{
  "status": "healthy",
  "timestamp": "2026-09-19T17:28:04.000Z",
  "uptime": 3622.4,
  "dependencies": {
    "supplierA": { "status": "up", "latencyMs": 3 },
    "supplierB": { "status": "up", "latencyMs": 4 },
    "temporal":  { "status": "up", "latencyMs": 12 },
    "redis":     { "status": "up", "latencyMs": 1 }
  }
}
```

**Response `207` (partial degradation):**
```json
{
  "status": "degraded",
  "timestamp": "2026-09-19T17:28:04.000Z",
  "uptime": 3622.4,
  "dependencies": {
    "supplierA": { "status": "up",   "latencyMs": 3 },
    "supplierB": { "status": "down", "latencyMs": 2001, "error": "ECONNREFUSED" },
    "temporal":  { "status": "up",   "latencyMs": 12 },
    "redis":     { "status": "up",   "latencyMs": 1 }
  }
}
```

---

### Mock Supplier Endpoints

**`GET /supplierA/hotels?city=delhi`**

The following raw supplier arrays show the original example records; each Delhi endpoint now returns 20 offers.

```json
[
  { "hotelId": "a1", "name": "Holtin",     "price": 6000,  "city": "delhi", "commissionPct": 10 },
  { "hotelId": "a2", "name": "Radison",    "price": 5900,  "city": "delhi", "commissionPct": 13 },
  { "hotelId": "a3", "name": "Lemon Tree", "price": 4200,  "city": "delhi", "commissionPct": 15 },
  { "hotelId": "a4", "name": "Taj Palace", "price": 12000, "city": "delhi", "commissionPct": 8  }
]
```

**`GET /supplierB/hotels?city=delhi`**
```json
[
  { "hotelId": "b1", "name": "Holtin",    "price": 5340,  "city": "delhi", "commissionPct": 20 },
  { "hotelId": "b2", "name": "Radison",   "price": 6400,  "city": "delhi", "commissionPct": 12 },
  { "hotelId": "b3", "name": "The Lalit", "price": 8100,  "city": "delhi", "commissionPct": 18 },
  { "hotelId": "b4", "name": "Taj Palace","price": 11500, "city": "delhi", "commissionPct": 9  }
]
```

---

## 12. Postman Collection Strategy

The Postman collection covers automated assertion tests for every scenario:

| Test Case                 | Request                                                   | Expected                                     |
|---|---|---|
| Valid city, full list     | `GET /api/hotels?city=delhi`                              | 200, 24 deduplicated hotels, X-Cache: MISS on a cold cache |
| Cache hit verification    | Same request again immediately                            | 200, X-Cache: HIT, faster response time      |
| Price range filter        | `GET /api/hotels?city=delhi&minPrice=4000&maxPrice=9000`  | 200, subset of hotels                        |
| Min price only            | `GET /api/hotels?city=delhi&minPrice=10000`               | 200, only expensive hotels                   |
| Max price only            | `GET /api/hotels?city=delhi&maxPrice=5000`                | 200, only cheap hotels                       |
| Empty results             | `GET /api/hotels?city=unknowncity`                        | 200 with `[]`                                |
| Missing city param        | `GET /api/hotels`                                         | 400 with error message                       |
| Invalid price param       | `GET /api/hotels?city=delhi&minPrice=abc`                 | 400                                          |
| Supplier A mock direct    | `GET /supplierA/hotels?city=delhi`                        | 200, raw array                               |
| Supplier B mock direct    | `GET /supplierB/hotels?city=delhi`                        | 200, raw array                               |
| Simulate supplier down    | `GET /supplierB/hotels` + header `X-Simulate-Down: true`  | 503                                          |
| Health check              | `GET /health`                                             | 200, all dependencies healthy                |

**Each request has automated test scripts:**
```javascript
pm.test("Status is 200", () => pm.response.to.have.status(200));
pm.test("Returns array", () => pm.expect(pm.response.json()).to.be.an('array'));
pm.test("Has correlation ID", () => pm.response.to.have.header('X-Correlation-Id'));
pm.test("Hotels have required fields", () => {
  pm.response.json().forEach(h => {
    pm.expect(h).to.have.all.keys('name', 'price', 'supplier', 'commissionPct');
  });
});
```

---

## 13. Edge Cases Handled

| Edge Case                                       | Handling                                                    |
|---|---|
| Same hotel name, different casing               | Normalized to lowercase for dedup key                       |
| `minPrice > maxPrice`                           | 400 Bad Request                                             |
| Supplier returns empty array for city           | Valid — other supplier's data used                          |
| Supplier returns HTTP 5xx                       | Temporal retries (up to 3x with backoff)                    |
| Supplier times out                              | HTTP timeout defaults to 5s; activity `startToCloseTimeout` is 15s; Temporal retries |
| Redis connection loss mid-request               | Falls back to in-memory result; logs warning                |
| Temporal server unreachable                     | Cache hit may still be served; on cache miss, stale fallback is used if enabled, otherwise 503 |
| Concurrent same-city requests (cold cache)      | Requests join an already-running workflow with the same deterministic workflowId |
| Price = 0                                       | Accepted as valid                                           |
| Both suppliers return same hotel at same price  | Either is selected deterministically (Supplier A first)     |

---

## 14. What Makes This Different

### Architectural Sophistication
- **Temporal is doing real work** — the workflow contains business logic; activities are isolated side effects. This is the textbook Temporal pattern, not just a wrapper.
- **Redis Sorted Sets** are purpose-built for range queries — not an afterthought.
- **Two separate processes** (API + Worker) mirror production deployments where workers scale independently from the web tier.

### Production-Grade Patterns
- Correlation IDs propagated end-to-end (request -> workflow -> activity -> log)
- Structured JSON logging with `pino` (not `console.log`)
- `zod` for environment variable validation at startup — fails fast with clear messages
- Single-flight via Temporal workflow ID deduplication — no request stampede on cold cache
- Stale cache fallback — prefer serving slightly old data over returning errors
- Non-retryable vs retryable errors properly classified in Temporal retry policy

### Observability
- **Temporal Web UI** at `:8080` — see every workflow execution, its timeline, and activity results visually
- **Health endpoint** probes all four dependencies independently with latency measurements
- **Response headers** communicate cache state, correlation identity, and Temporal run ID

### Developer Experience
- `docker compose up` — everything running in one command
- `.env.example` with all required vars documented
- Postman collection with automated assertions — not just "click and hope"
- TypeScript throughout — type-safe workflow inputs/outputs and activity return types

---

*This document describes the current implementation. The mock data contains 20 offers per supplier for Delhi, 15 for Mumbai, and 10 for Bangalore; the final deduplicated counts are 24, 20, and 14 respectively.*

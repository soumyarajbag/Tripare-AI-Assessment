# 🏨 Hotel Offer Orchestrator

> Aggregate overlapping hotel offers from two mock suppliers, deduplicate by best price, and filter results — orchestrated by **Temporal.io**, cached in **Redis**, served via **Express + TypeScript**.

---

## Architecture

```
Client → Express API → Temporal Workflow → [Supplier A Activity ‖ Supplier B Activity]
                   ↓                               ↓
              Redis ZSET              deduplicateAndSelectBest()
          (ZRANGEBYSCORE)                    (in workflow)
```

- **Two supplier HTTP activities** run in **parallel** inside a Temporal Workflow
- **Deduplication + best-price selection** lives inside the workflow (replayable, auditable)
- **Redis Sorted Set** stores hotels with `score=price` → `ZRANGEBYSCORE` for O(log N + M) price filtering, where M is the result count
- **Same Docker image, two roles**: `ROLE=api` starts Express; `ROLE=worker` starts Temporal Worker

---

## Quick Start (Docker)

```bash
# 1. Clone the repository
git clone <repo-url>
cd hotel-offer-orchestrator

# 2. Start everything
docker compose up --build

# 3. Wait ~30s for Temporal to initialise, then test
curl http://localhost:3000/health
curl "http://localhost:3000/api/hotels?city=delhi"
```

Compose starts the API and Temporal worker, a Temporal server backed by PostgreSQL, Redis, and the Temporal UI. PostgreSQL and Redis data use named volumes.

**Services:**
| Service | URL |
|---|---|
| API | http://localhost:3000 |
| Temporal Web UI | http://localhost:8080 |
| Redis | localhost:6379 |

---

## Local Development (without Docker)

**Prerequisites:** Node.js 20+, Redis 7+, and Temporal CLI (or Docker for Temporal)

The local defaults in `src/config/env.ts` target `localhost` for Redis, Temporal, and the mock supplier API. The application reads environment variables from the process; it does not automatically load a `.env` file. `.env.example` is a reference template. Set any overrides in the shell where you start each process. Docker Compose has its own service configuration in `docker-compose.yml`.

```bash
# Install dependencies
npm install

# Start Temporal locally (requires Temporal CLI)
temporal server start-dev

# Terminal 1 — API server
npm run dev:api

# Terminal 2 — Temporal Worker
npm run dev:worker
```

---

## API Reference

### `GET /api/hotels`

Fetches deduplicated, best-priced hotels for a city.

| Param | Type | Required | Description |
|---|---|---|---|
| `city` | string | ✅ | City name (case-insensitive) |
| `minPrice` | number | ❌ | Minimum price (inclusive) |
| `maxPrice` | number | ❌ | Maximum price (inclusive) |

**Examples:**
```bash
# All hotels for Delhi
curl "http://localhost:3000/api/hotels?city=delhi"

# Hotels between ₹4,000 and ₹9,000
curl "http://localhost:3000/api/hotels?city=delhi&minPrice=4000&maxPrice=9000"

# Hotels above ₹10,000
curl "http://localhost:3000/api/hotels?city=delhi&minPrice=10000"
```

**Example response excerpt:**

The full Delhi response contains 24 deduplicated hotels; these entries illustrate the selected winners.

```json
[
  { "name": "Holtin",  "price": 5340, "supplier": "Supplier B", "commissionPct": 20 },
  { "name": "Radison", "price": 5900, "supplier": "Supplier A", "commissionPct": 13 }
]
```

**Response Headers:**
- `X-Cache: HIT | MISS` — whether Redis served the response
- `X-Correlation-Id: <uuid>` — trace ID for every request
- `X-Temporal-Run-Id: <runId>` — Temporal run that produced this data when a run ID is available
- `X-Data-Stale: true` — when stale cache fallback is served

---

### `GET /health`

Independent health probe for all four dependencies.

```bash
curl http://localhost:3000/health
```

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

HTTP status: `200` healthy · `207` degraded · `503` unhealthy

---

### Mock Supplier Endpoints

```bash
GET /supplierA/hotels?city=delhi   # Raw Supplier A data
GET /supplierB/hotels?city=delhi   # Raw Supplier B data

# Simulate supplier outage (header-triggered)
curl -H "X-Simulate-Down: true" http://localhost:3000/supplierB/hotels?city=delhi
# → 503
```

---

## Postman Collection

Import `postman/HotelOfferOrchestrator.postman_collection.json` into Postman.

Set collection variable `base_url = http://localhost:3000` and run all requests.

Requests and assertions included:
- Deduplication correctness (Holtin → Supplier B, Radison → Supplier A)
- Cache header presence and HIT behavior on a repeated request
- Price range filtering accuracy
- Query validation errors (400) and an unknown city returning an empty array (200)
- Health check dependency structure
- Supplier failure simulation

---

## Project Structure

Express requests follow `src/api/routes/ -> src/api/controllers/ -> src/services/`. Routes map URLs to handlers, controllers validate HTTP input and shape responses, and services own orchestration and data access. Shared logging lives in `src/infrastructure/logger.ts`; typed HTTP errors live in `src/api/errors/httpError.ts`.

Both Temporal supplier activities are implemented in `src/temporal/activities/supplierActivities.ts`.

```
src/
├── api/
│   ├── controllers/     hotels · health · supplier
│   ├── errors/          typed HTTP errors
│   ├── middleware/     correlationId · requestLogger · errorHandler
│   ├── routes/          hotels · health · supplierA · supplierB
│   └── server.ts        Express app factory
├── temporal/
│   ├── activities/      fetchFromSupplierA · fetchFromSupplierB
│   ├── workflows/       HotelAggregatorWorkflow
│   ├── client.ts        Temporal Client singleton
│   └── worker.ts        Temporal Worker entry
├── services/
│   ├── hotelAggregator.service.ts   Core orchestration (cache → Temporal → cache)
│   ├── supplier.service.ts          Mock supplier adapter and latency
│   ├── redis.service.ts             ZSET read/write helpers
│   └── health.service.ts            Dependency probe logic
├── domain/
│   ├── hotel.types.ts               All TypeScript interfaces
│   └── deduplication.ts            Pure dedup function
├── infrastructure/
│   └── logger.ts                    Shared structured logger
├── data/
│   └── mockSupplierData.ts         Static mock hotel datasets
├── config/
│   └── env.ts                      Zod-validated env vars
└── index.ts                        Entrypoint (ROLE-based boot)
```

Mock inventory includes 20 offers per supplier for Delhi, 15 for Mumbai, and 10 for Bangalore. After deduplication, the expected totals are 24, 20, and 14 hotels respectively. Each city has overlapping hotels with different prices plus supplier-only listings, so both comparison and deduplication cases are represented.

---

## Key Design Decisions

| Decision | Rationale |
|---|---|
| Dedup logic inside Temporal Workflow | Replayable, auditable via Temporal UI, retryable at activity level |
| Redis Sorted Set (not plain JSON) | `ZRANGEBYSCORE` gives O(log N + M) price filtering, where M is the result count |
| `Promise.allSettled` in workflow | Graceful degradation — one supplier down doesn't kill the request |
| Deterministic `workflowId` | Concurrent cold requests can join the same in-flight city workflow |
| Two roles, one image | Worker and API scale independently without separate codebases |
| Stale cache fallback | Serves slightly old data rather than erroring when all systems fail |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `production`, or `test` |
| `PORT` | `3000` | HTTP server port |
| `ROLE` | `api` | `api` or `worker` |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal gRPC endpoint |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `TEMPORAL_TASK_QUEUE` | `hotel-offer-queue` | Task queue name |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | unset | Optional Redis password |
| `REDIS_CACHE_TTL_SECONDS` | `300` | Cache TTL (5 min) |
| `SUPPLIER_A_BASE_URL` | `http://localhost:3000` | Supplier A base URL |
| `SUPPLIER_B_BASE_URL` | `http://localhost:3000` | Supplier B base URL |
| `ALLOW_STALE_CACHE` | `true` | Serve stale data on supplier failure |
| `SUPPLIER_REQUEST_TIMEOUT_MS` | `5000` | Activity HTTP timeout |
| `HEALTH_PROBE_TIMEOUT_MS` | `2000` | Health check probe timeout |

import Redis from 'ioredis';
import { env } from '../config/env';
import { Hotel, CacheMeta } from '../domain/hotel.types';
import { logger } from '../infrastructure/logger';

// ─── Singleton Redis client ────────────────────────────────────────────────────

let _redis: Redis | null = null;

export function getRedisClient(): Redis {
  if (_redis) return _redis;

  _redis = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    lazyConnect: true,
    retryStrategy: (times) => {
      if (times > 5) return null; // stop retrying after 5 attempts
      return Math.min(times * 200, 2000);
    },
    enableOfflineQueue: false,
  });

  _redis.on('error', (err: Error) => {
    logger.error({ msg: 'Redis client error', error: err.message });
  });

  _redis.on('connect', () => {
    logger.info('Redis: connected');
  });

  return _redis;
}

export async function closeRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = null;
  }
}

// ─── Key helpers ─────────────────────────────────────────────────────────────

const pricesKey = (city: string) => `hotel:${city.toLowerCase()}:prices`;
const metaKey = (city: string) => `hotel:${city.toLowerCase()}:meta`;
const stalePricesKey = (city: string) => `hotel:${city.toLowerCase()}:stale:prices`;
const staleMetaKey = (city: string) => `hotel:${city.toLowerCase()}:stale:meta`;
const STALE_CACHE_TTL_SECONDS = 24 * 60 * 60;

// ─── Cache read ───────────────────────────────────────────────────────────────

/**
 * Returns hotels for the given city from the Redis Sorted Set.
 * Uses ZRANGEBYSCORE so price filtering is done in Redis — no JS iteration.
 * Returns null if the cache key does not exist (cache miss).
 */
export async function readFromCache(
  city: string,
  minPrice?: number,
  maxPrice?: number,
): Promise<Hotel[] | null> {
  const redis = getRedisClient();
  const key = pricesKey(city);

  try {
    const [metaExists, pricesExist, cachedCount] = await Promise.all([
      redis.exists(metaKey(city)),
      redis.exists(key),
      redis.hget(metaKey(city), 'totalCount'),
    ]);
    if (!metaExists || (Number(cachedCount) > 0 && !pricesExist)) return null;

    const lo = minPrice !== undefined ? minPrice : '-inf';
    const hi = maxPrice !== undefined ? maxPrice : '+inf';

    const members = await redis.zrangebyscore(key, lo, hi);
    return members.map((m) => JSON.parse(m) as Hotel);
  } catch (err) {
    logger.warn({ msg: 'Redis read failed, treating as cache miss', error: (err as Error).message, city });
    return null;
  }
}

// ─── Cache write ─────────────────────────────────────────────────────────────

/**
 * Writes the deduplicated hotel list into a Redis Sorted Set.
 * score = price, member = JSON-serialised Hotel object.
 * Uses a Redis transaction for an atomic cache refresh.
 */
export async function writeToCache(
  city: string,
  hotels: Hotel[],
  meta: CacheMeta,
): Promise<void> {
  const redis = getRedisClient();
  const pKey = pricesKey(city);
  const mKey = metaKey(city);
  const stalePKey = stalePricesKey(city);
  const staleMKey = staleMetaKey(city);

  try {
    const pipeline = redis.multi();

    // Overwrite any existing set for this city
    pipeline.del(pKey);
    for (const hotel of hotels) {
      pipeline.zadd(pKey, String(hotel.price), JSON.stringify(hotel));
    }
    if (hotels.length > 0) pipeline.expire(pKey, env.REDIS_CACHE_TTL_SECONDS);

    // Store metadata alongside
    pipeline.hset(mKey, {
      cachedAt: meta.cachedAt,
      workflowRunId: meta.workflowRunId,
      totalCount: meta.totalCount.toString(),
    });
    pipeline.expire(mKey, env.REDIS_CACHE_TTL_SECONDS);

    // Keep the last non-empty snapshot for up to one day after fresh-cache expiry.
    if (hotels.length > 0) {
      pipeline.del(stalePKey);
      for (const hotel of hotels) {
        pipeline.zadd(stalePKey, String(hotel.price), JSON.stringify(hotel));
      }
      pipeline.expire(stalePKey, STALE_CACHE_TTL_SECONDS);
      pipeline.hset(staleMKey, {
        cachedAt: meta.cachedAt,
        workflowRunId: meta.workflowRunId,
        totalCount: meta.totalCount.toString(),
      });
      pipeline.expire(staleMKey, STALE_CACHE_TTL_SECONDS);
    }

    await pipeline.exec();

    logger.info({
      msg: 'Redis: cache written',
      city,
      count: hotels.length,
      ttl: env.REDIS_CACHE_TTL_SECONDS,
    });
  } catch (err) {
    logger.warn({ msg: 'Redis write failed, continuing without cache', error: (err as Error).message, city });
  }
}

// ─── Stale read (ignores TTL by reading an expired key if Redis allows) ───────

/**
 * Reads all hotels regardless of price filter — used as stale fallback
 * when both suppliers are unavailable.
 * Returns null if the key doesn't exist at all.
 */
export async function readAllFromCache(city: string): Promise<{ hotels: Hotel[]; meta: CacheMeta | null } | null> {
  const redis = getRedisClient();
  const pKey = stalePricesKey(city);
  const mKey = staleMetaKey(city);

  try {
    const [metaExists, pricesExist, cachedCount] = await Promise.all([
      redis.exists(mKey),
      redis.exists(pKey),
      redis.hget(mKey, 'totalCount'),
    ]);
    if (!metaExists || (Number(cachedCount) > 0 && !pricesExist)) return null;
    const members = await redis.zrange(pKey, '0', '-1');

    const hotels = members.map((m) => JSON.parse(m) as Hotel);

    const rawMeta = await redis.hgetall(mKey);
    const meta: CacheMeta | null =
      rawMeta && rawMeta['cachedAt']
        ? {
            cachedAt: rawMeta['cachedAt'],
            workflowRunId: rawMeta['workflowRunId'] ?? '',
            totalCount: parseInt(rawMeta['totalCount'] ?? '0', 10),
          }
        : null;

    return { hotels, meta };
  } catch {
    return null;
  }
}

// ─── Health probe ─────────────────────────────────────────────────────────────

export async function pingRedis(): Promise<void> {
  const redis = getRedisClient();
  await redis.ping();
}

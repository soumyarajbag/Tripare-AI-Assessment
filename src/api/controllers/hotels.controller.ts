import { type Request, type RequestHandler } from 'express';
import type { HotelQueryParams } from '../../domain/hotel.types';
import { aggregateHotels } from '../../services/hotelAggregator.service';
import { HttpError } from '../errors/httpError';

function parsePrice(value: unknown, parameter: 'minPrice' | 'maxPrice'): number | undefined {
  if (value === undefined) return undefined;

  const errorCode = parameter === 'minPrice' ? 'INVALID_MIN_PRICE' : 'INVALID_MAX_PRICE';
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(400, `\`${parameter}\` must be a non-negative number`, errorCode);
  }

  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) {
    throw new HttpError(400, `\`${parameter}\` must be a non-negative number`, errorCode);
  }

  return price;
}

function parseHotelQuery(query: Request['query']): HotelQueryParams {
  const city = query['city'];
  if (typeof city !== 'string' || city.trim() === '') {
    throw new HttpError(400, '`city` query parameter is required', 'MISSING_CITY');
  }

  const minPrice = parsePrice(query['minPrice'], 'minPrice');
  const maxPrice = parsePrice(query['maxPrice'], 'maxPrice');

  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    throw new HttpError(400, '`minPrice` must be less than or equal to `maxPrice`', 'INVALID_PRICE_RANGE');
  }

  return { city: city.trim().toLowerCase(), minPrice, maxPrice };
}

/** Handles GET /api/hotels and translates the application result into HTTP. */
export const getHotels: RequestHandler = async (req, res, next) => {
  try {
    const params = parseHotelQuery(req.query);
    const result = await aggregateHotels(params, req.correlationId);

    res.setHeader('X-Cache', result.cacheHit ? 'HIT' : 'MISS');
    if (result.temporalRunId) res.setHeader('X-Temporal-Run-Id', result.temporalRunId);
    if (result.stale) res.setHeader('X-Data-Stale', 'true');

    res.status(200).json(result.hotels);
  } catch (error) {
    if (error instanceof HttpError) {
      next(error);
      return;
    }

    const message = error instanceof Error ? error.message : 'Service unavailable';
    next(new HttpError(503, `Unable to fetch hotel data: ${message}`, 'SERVICE_UNAVAILABLE'));
  }
};

import axios from 'axios';
import { ApplicationFailure, Context } from '@temporalio/activity';
import { SupplierHotel } from '../../domain/hotel.types';
import { env } from '../../config/env';

function validateSupplierHotels(value: unknown, supplierName: string, city: string): SupplierHotel[] {
  if (!Array.isArray(value)) {
    throw ApplicationFailure.nonRetryable(
      `${supplierName} returned a non-array response for city=${city}`,
      'SupplierDataValidationError',
    );
  }

  const malformedHotel = value.findIndex((hotel: unknown) => {
    if (hotel === null || typeof hotel !== 'object') return true;

    const candidate = hotel as Partial<SupplierHotel>;
    return (
      typeof candidate.hotelId !== 'string' || candidate.hotelId.trim() === '' ||
      typeof candidate.name !== 'string' || candidate.name.trim() === '' ||
      typeof candidate.price !== 'number' || !Number.isFinite(candidate.price) || candidate.price < 0 ||
      typeof candidate.city !== 'string' || candidate.city.toLowerCase() !== city.toLowerCase() ||
      typeof candidate.commissionPct !== 'number' || !Number.isFinite(candidate.commissionPct) ||
      candidate.commissionPct < 0 || candidate.commissionPct > 100
    );
  });

  if (malformedHotel !== -1) {
    throw ApplicationFailure.nonRetryable(
      `${supplierName} returned an invalid hotel at index=${malformedHotel} for city=${city}`,
      'SupplierDataValidationError',
    );
  }

  return value as SupplierHotel[];
}

async function fetchSupplierHotels(
  supplierName: 'Supplier A' | 'Supplier B',
  endpoint: string,
  city: string,
  correlationId: string,
): Promise<SupplierHotel[]> {
  const ctx = Context.current();
  const attempt = ctx.info.attempt;
  ctx.log.info(`${supplierName} activity: starting`, { city, correlationId, attempt });

  try {
    const response = await axios.get<unknown>(endpoint, {
      params: { city },
      timeout: env.SUPPLIER_REQUEST_TIMEOUT_MS,
      headers: {
        'X-Internal-Call': 'true',
        'X-Correlation-Id': correlationId,
      },
    });

    const hotels = validateSupplierHotels(response.data, supplierName, city);
    ctx.log.info(`${supplierName} activity: completed`, {
      city,
      correlationId,
      count: hotels.length,
    });
    return hotels;
  } catch (err) {
    if (err instanceof ApplicationFailure) throw err;

    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    const reason = err instanceof Error ? err.message : String(err);
    const message = `${supplierName} request failed for city=${city}: ${reason}`;

    ctx.log.warn(`${supplierName} activity: failed`, { city, correlationId, attempt, status, message });

    if (status !== undefined && status >= 400 && status < 500) {
      throw ApplicationFailure.nonRetryable(message, 'SupplierHttpError');
    }

    throw new Error(message);
  }
}

/** Fetches and validates the Supplier A mock response for the requested city. */
export async function fetchFromSupplierA(city: string, correlationId: string): Promise<SupplierHotel[]> {
  return fetchSupplierHotels(
    'Supplier A',
    `${env.SUPPLIER_A_BASE_URL}/supplierA/hotels`,
    city,
    correlationId,
  );
}

/** Fetches and validates the Supplier B mock response for the requested city. */
export async function fetchFromSupplierB(city: string, correlationId: string): Promise<SupplierHotel[]> {
  return fetchSupplierHotels(
    'Supplier B',
    `${env.SUPPLIER_B_BASE_URL}/supplierB/hotels`,
    city,
    correlationId,
  );
}

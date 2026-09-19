import type { SupplierHotel } from '../domain/hotel.types';
import { getSupplierAHotels, getSupplierBHotels } from '../data/mockSupplierData';

export type MockSupplierId = 'A' | 'B';

/**
 * Supplier adapter for the in-process mock APIs.
 * Keeps the data source and mock latency out of Express controllers.
 */
export async function getMockSupplierHotels(
  supplier: MockSupplierId,
  city: string,
): Promise<SupplierHotel[]> {
  const hotels = supplier === 'A' ? getSupplierAHotels(city) : getSupplierBHotels(city);
  const latencyMs = supplier === 'A' ? 20 : 30;

  await new Promise<void>((resolve) => setTimeout(resolve, latencyMs));
  return hotels;
}

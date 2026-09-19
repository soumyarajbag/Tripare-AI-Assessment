import { Hotel, SupplierHotel } from './hotel.types';

/**
 * Pure, deterministic function — safe to call inside a Temporal Workflow.
 *
 * Rules:
 *  1. Hotels are deduplicated by normalised name (lowercase + trimmed).
 *  2. When the same hotel appears in both suppliers, the cheaper price wins.
 *  3. If a hotel appears in only one supplier, it is included as-is.
 *  4. Result is sorted ascending by price.
 *  5. Tie-break on equal price: Supplier A preferred (deterministic ordering).
 */
export function deduplicateAndSelectBest(
  suppliersA: SupplierHotel[],
  suppliersB: SupplierHotel[],
): Hotel[] {
  const map = new Map<string, Hotel>();

  const processHotels = (hotels: SupplierHotel[], supplierName: string): void => {
    for (const h of hotels) {
      const key = h.name.toLowerCase().trim();
      const candidate: Hotel = {
        name: h.name,
        price: h.price,
        supplier: supplierName,
        commissionPct: h.commissionPct,
      };

      const existing = map.get(key);
      // Accept if new, or if strictly cheaper (tie-break: keep existing = Supplier A preferred)
      if (existing === undefined || h.price < existing.price) {
        map.set(key, candidate);
      }
    }
  };

  // Process A first so that equal-price ties favour Supplier A
  processHotels(suppliersA, 'Supplier A');
  processHotels(suppliersB, 'Supplier B');

  return Array.from(map.values()).sort((a, b) => a.price - b.price);
}

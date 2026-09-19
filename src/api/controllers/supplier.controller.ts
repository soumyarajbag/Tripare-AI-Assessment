import { type RequestHandler } from 'express';
import { getMockSupplierHotels, type MockSupplierId } from '../../services/supplier.service';

function createSupplierHotelsController(supplier: MockSupplierId): RequestHandler {
  const supplierName = `Supplier ${supplier}`;

  return async (req, res) => {
    if (req.get('X-Simulate-Down') === 'true') {
      res.status(503).json({ error: `${supplierName} is simulated as down` });
      return;
    }

    const city = typeof req.query['city'] === 'string' ? req.query['city'].toLowerCase() : '';
    const hotels = await getMockSupplierHotels(supplier, city);
    res.status(200).json(hotels);
  };
}

export const getSupplierAHotels = createSupplierHotelsController('A');
export const getSupplierBHotels = createSupplierHotelsController('B');

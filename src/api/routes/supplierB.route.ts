import { Router } from 'express';
import { getSupplierBHotels } from '../controllers/supplier.controller';

const router = Router();

router.get('/hotels', getSupplierBHotels);

export default router;

import { Router } from 'express';
import { getSupplierAHotels } from '../controllers/supplier.controller';

const router = Router();

router.get('/hotels', getSupplierAHotels);

export default router;

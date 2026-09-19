import { Router } from 'express';
import { getHotels } from '../controllers/hotels.controller';

const router = Router();

router.get('/', getHotels);

export default router;

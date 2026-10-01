import { Router } from 'express';
import { listSales, createSale } from '../controllers/sales.controller';
import { authMiddleware, roleMiddleware } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

router.get('/', roleMiddleware('admin', 'store'), listSales);
router.post('/', roleMiddleware('admin', 'store'), createSale);

export default router;

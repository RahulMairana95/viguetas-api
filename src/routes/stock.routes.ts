import { Router } from 'express';
import { listStock, getStockItem, upsertStock } from '../controllers/stock.controller';
import { authMiddleware, roleMiddleware } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

router.get('/', roleMiddleware('admin', 'store'), listStock);
router.get('/:warehouseId/:productId', roleMiddleware('admin', 'store'), getStockItem);
router.post('/', roleMiddleware('admin'), upsertStock);

export default router;

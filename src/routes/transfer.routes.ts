import { Router } from 'express';
import { listTransfers, createTransfer } from '../controllers/transfers.controller';
import { authMiddleware, roleMiddleware } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

router.get('/', roleMiddleware('admin', 'store'), listTransfers);
router.post('/', roleMiddleware('admin', 'store'), createTransfer);

export default router;

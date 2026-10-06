import { Router } from 'express';
import { getPlanningReport } from '../controllers/planning.controller';
import { authMiddleware, roleMiddleware } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

router.get('/', roleMiddleware('admin'), getPlanningReport);

export default router;

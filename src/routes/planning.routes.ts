import { Router } from 'express';
import { getPlanningReport } from '../controllers/planning.controller';
import { requireAuth, requireRole } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(requireAuth);

router.get('/', requireRole('admin'), getPlanningReport);

export default router;

import { Router } from 'express';
import { listSales, createSale, updateSale, deliverSale, cancelSale } from '../controllers/sales.controller';
import { requireAuth, requireRole } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(requireAuth);

router.get('/', requireRole('admin', 'promoter'), listSales);
// promoter: solo ventas inmediatas (se valida dentro de createSale)
router.post('/', requireRole('admin', 'promoter'), createSale);
// Programar, editar, entregar y cancelar: solo admin
router.patch('/:id', requireRole('admin'), updateSale);
router.post('/:id/deliver', requireRole('admin'), deliverSale);
router.post('/:id/cancel', requireRole('admin'), cancelSale);

export default router;

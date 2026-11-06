import { Router } from 'express';
import {
  listQuotes,
  createQuote,
  updateQuote,
  deleteQuote,
  convertQuote,
  cancelQuote,
} from '../controllers/quotes.controller';
import { requireAuth, requireRole } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(requireAuth);

// Cotizar puede el admin y el promoter (presupuesto previo al pedido).
router.get('/', requireRole('admin', 'promoter'), listQuotes);
router.post('/', requireRole('admin', 'promoter'), createQuote);
router.patch('/:id', requireRole('admin', 'promoter'), updateQuote);
router.delete('/:id', requireRole('admin', 'promoter'), deleteQuote);
// Convertir a pedido (venta programada) y cancelar: solo admin.
router.post('/:id/convert', requireRole('admin'), convertQuote);
router.post('/:id/cancel', requireRole('admin'), cancelQuote);

export default router;

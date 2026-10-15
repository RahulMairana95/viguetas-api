import { Router } from 'express';
import { listStock, getStockItem, upsertStock } from '../controllers/stock.controller';
import { requireAuth, requireRole } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(requireAuth);

router.get('/', requireRole('admin', 'store'), listStock);
router.get('/:warehouseId/:productId', requireRole('admin', 'store'), getStockItem);
// Ajuste manual de stock: el admin elige el almacén en el body, así puede
// cargar el inventario inicial de cualquier tienda y corregir conteos físicos.
router.post('/', requireRole('admin'), upsertStock);

export default router;

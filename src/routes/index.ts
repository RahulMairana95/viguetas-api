import { Router } from 'express';
import authRoutes from './auth.routes';
import warehouseRoutes from './warehouse.routes';
import productRoutes from './product.routes';
import stockRoutes from './stock.routes';
import transferRoutes from './transfer.routes';
import clientRoutes from './client.routes';
import saleRoutes from './sale.routes';
import orderRoutes from './order.routes';
import productionRoutes from './production.routes';
import stockRequestRoutes from './stockRequest.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/warehouses', warehouseRoutes);
router.use('/products', productRoutes);
router.use('/stock', stockRoutes);
router.use('/transfers', transferRoutes);
router.use('/clients', clientRoutes);
router.use('/sales', saleRoutes);
router.use('/orders', orderRoutes);
router.use('/productions', productionRoutes);
router.use('/stock-requests', stockRequestRoutes);

export default router;

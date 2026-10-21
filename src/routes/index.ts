import { Router } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import warehouseRoutes from './warehouse.routes';
import productRoutes from './product.routes';
import stockRoutes from './stock.routes';
import clientRoutes from './client.routes';
import saleRoutes from './sale.routes';
import puntalRoutes from './puntal.routes';
import productionRoutes from './production.routes';
import planningRoutes from './planning.routes';
import quoteRoutes from './quote.routes';

const router: ReturnType<typeof Router> = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/warehouses', warehouseRoutes);
router.use('/products', productRoutes);
router.use('/stock', stockRoutes);
router.use('/clients', clientRoutes);
router.use('/sales', saleRoutes);
router.use('/puntales', puntalRoutes);
router.use('/productions', productionRoutes);
router.use('/planning', planningRoutes);
router.use('/quotes', quoteRoutes);

export default router;

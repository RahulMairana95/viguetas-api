import { Router, Request, Response } from 'express';
import { eq, sum } from 'drizzle-orm';
import { db } from '../db';
import { stock, orders, orderItems, products } from '../db/schema';
import { authMiddleware, roleMiddleware } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

// GET /api/stock-requests (needs report - calculated on the fly)
router.get('/', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    // Get all pending orders with their items
    const pendingOrders = await db.select({
      orderId: orders.id,
      productId: orderItems.productId,
      quantity: orderItems.quantity,
    })
      .from(orders)
      .innerJoin(orderItems, eq(orders.id, orderItems.orderId))
      .where(eq(orders.status, 'pending'));

    // Calculate demanded quantity per product
    const demandedByProduct: Record<string, { product: any; quantity: number }> = {};

    for (const item of pendingOrders) {
      const productId = item.productId;
      if (!demandedByProduct[productId]) {
        // Get product details
        const [product] = await db.select().from(products)
          .where(eq(products.id, productId));

        demandedByProduct[productId] = {
          product,
          quantity: 0,
        };
      }
      demandedByProduct[productId].quantity += item.quantity;
    }

    // Get all stock across all warehouses
    const allStock = await db.select({
      productId: stock.productId,
      total: sum(stock.quantity),
    })
      .from(stock)
      .groupBy(stock.productId);

    // Create a map of available stock per product
    const availableByProduct: Record<string, number> = {};
    for (const s of allStock) {
      availableByProduct[s.productId] = Number(s.total) || 0;
    }

    // Calculate deficit
    const result = Object.values(demandedByProduct).map(({ product, quantity: demanded }) => {
      const available = availableByProduct[product?.id] || 0;
      const deficit = Math.max(0, demanded - available);

      return {
        productId: product?.id,
        product,
        demanded,
        available,
        deficit,
      };
    });

    // Sort by deficit (highest first)
    result.sort((a, b) => b.deficit - a.deficit);

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;
    
    const paginatedResult = result.slice(offset, offset + limit);

    res.json({
      data: paginatedResult,
      pagination: {
        page,
        limit,
        total: result.length,
        totalPages: Math.ceil(result.length / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error calculating stock needs' });
  }
});

export default router;

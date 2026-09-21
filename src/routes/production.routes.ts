import { Router, Request, Response } from 'express';
import { eq, and, count, ilike, or } from 'drizzle-orm';
import { db } from '../db';
import { productions, products, orders, users, stock, warehouses } from '../db/schema';
import { authMiddleware, roleMiddleware } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

// GET /api/productions?search=...
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const search = (req.query.search as string)?.replace(/['"]/g, '').trim() || '';
    const { status, orderId } = req.query;

    const conditions = [];
    if (status) conditions.push(eq(productions.status, status as 'pending' | 'completed'));
    if (orderId) conditions.push(eq(productions.orderId, orderId as string));
    if (search) conditions.push(or(
      ilike(products.name, `%${search}%`),
      ilike(productions.notes, `%${search}%`)
    ));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const [{ total }] = await db.select({ total: count() }).from(productions).where(whereClause);

    const allProductions = await db.select({
      id: productions.id,
      productId: productions.productId,
      quantity: productions.quantity,
      status: productions.status,
      orderId: productions.orderId,
      date: productions.date,
      userId: productions.userId,
      notes: productions.notes,
      product: {
        id: products.id,
        name: products.name,
        productType: products.productType,
        measurement: products.measurement,
      },
      order: {
        id: orders.id,
        deliveryPlace: orders.deliveryPlace,
        status: orders.status,
      },
      user: {
        id: users.id,
        name: users.name,
      },
    })
      .from(productions)
      .innerJoin(products, eq(productions.productId, products.id))
      .leftJoin(orders, eq(productions.orderId, orders.id))
      .innerJoin(users, eq(productions.userId, users.id))
      .where(whereClause)
      .limit(limit)
      .offset(offset);

    res.json({
      data: allProductions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching productions' });
  }
});

// POST /api/productions
router.post('/', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { productId, quantity, orderId, notes } = req.body;

    if (!productId || !quantity) {
      res.status(400).json({ message: 'productId and quantity are required' });
      return;
    }

    const [production] = await db.insert(productions)
      .values({
        productId,
        quantity,
        orderId: orderId || null,
        notes,
        userId: req.user!.userId,
      })
      .returning();

    res.status(201).json(production);
  } catch (error) {
    res.status(500).json({ message: 'Error creating production' });
  }
});

// PATCH /api/productions/:id/complete
router.patch('/:id/complete', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const [production] = await db.select().from(productions)
      .where(eq(productions.id, id));

    if (!production) {
      res.status(404).json({ message: 'Production not found' });
      return;
    }

    if (production.status === 'completed') {
      res.status(400).json({ message: 'Production already completed' });
      return;
    }

    const result = await db.transaction(async (tx) => {
      // Update production status
      const [updated] = await tx.update(productions)
        .set({ status: 'completed' })
        .where(eq(productions.id, id))
        .returning();

      // Find factory warehouse
      const [factory] = await tx.select().from(warehouses)
        .where(eq(warehouses.type, 'factory'));

      if (factory) {
        // Check if stock exists in factory
        const [existingStock] = await tx.select().from(stock)
          .where(and(eq(stock.warehouseId, factory.id), eq(stock.productId, production.productId)));

        if (existingStock) {
          // Update stock
          await tx.update(stock)
            .set({ quantity: existingStock.quantity + production.quantity })
            .where(and(eq(stock.warehouseId, factory.id), eq(stock.productId, production.productId)));
        } else {
          // Create new stock
          await tx.insert(stock)
            .values({
              warehouseId: factory.id,
              productId: production.productId,
              quantity: production.quantity,
            });
        }
      }

      return updated;
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error completing production' });
  }
});

export default router;

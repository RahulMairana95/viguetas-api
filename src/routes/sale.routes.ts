import { Router, Request, Response } from 'express';
import { eq, and, count, ilike, or } from 'drizzle-orm';
import { db } from '../db';
import { stock, sales, clients, products, warehouses, users } from '../db/schema';
import { authMiddleware } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

// GET /api/sales?search=...
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const search = (req.query.search as string) || '';
    const { warehouseId, clientId } = req.query;

    const conditions = [];
    if (warehouseId) conditions.push(eq(sales.warehouseId, warehouseId as string));
    if (clientId) conditions.push(eq(sales.clientId, clientId as string));
    if (search) conditions.push(or(
      ilike(clients.name, `%${search}%`),
      ilike(products.name, `%${search}%`)
    ));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const [{ total }] = await db.select({ total: count() }).from(sales).where(whereClause);

    const allSales = await db.select({
      id: sales.id,
      clientId: sales.clientId,
      productId: sales.productId,
      warehouseId: sales.warehouseId,
      quantity: sales.quantity,
      unitPrice: sales.unitPrice,
      date: sales.date,
      userId: sales.userId,
      client: {
        id: clients.id,
        name: clients.name,
      },
      product: {
        id: products.id,
        name: products.name,
        productType: products.productType,
        measurement: products.measurement,
      },
      warehouse: {
        id: warehouses.id,
        name: warehouses.name,
      },
      user: {
        id: users.id,
        name: users.name,
      },
    })
      .from(sales)
      .innerJoin(clients, eq(sales.clientId, clients.id))
      .innerJoin(products, eq(sales.productId, products.id))
      .innerJoin(warehouses, eq(sales.warehouseId, warehouses.id))
      .innerJoin(users, eq(sales.userId, users.id))
      .where(whereClause)
      .limit(limit)
      .offset(offset);

    res.json({
      data: allSales,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching sales' });
  }
});

// POST /api/sales
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientId, productId, warehouseId, quantity, unitPrice } = req.body;

    if (!clientId || !productId || !warehouseId || !quantity) {
      res.status(400).json({ message: 'clientId, productId, warehouseId and quantity are required' });
      return;
    }

    const result = await db.transaction(async (tx) => {
      // Check stock
      const [stockItem] = await tx.select().from(stock)
        .where(and(eq(stock.warehouseId, warehouseId), eq(stock.productId, productId)));

      if (!stockItem || stockItem.quantity < quantity) {
        throw new Error('Insufficient stock');
      }

      // Create sale
      const [sale] = await tx.insert(sales)
        .values({
          clientId,
          productId,
          warehouseId,
          quantity,
          unitPrice,
          userId: req.user!.userId,
        })
        .returning();

      // Update stock
      await tx.update(stock)
        .set({ quantity: stockItem.quantity - quantity })
        .where(and(eq(stock.warehouseId, warehouseId), eq(stock.productId, productId)));

      return sale;
    });

    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message || 'Error creating sale' });
  }
});

export default router;

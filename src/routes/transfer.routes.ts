import { Router, Request, Response } from 'express';
import { eq, and, count, ilike, or } from 'drizzle-orm';
import { db } from '../db';
import { stock, transfers, warehouses, products, users } from '../db/schema';
import { authMiddleware } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

// GET /api/transfers?search=...
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const search = (req.query.search as string)?.replace(/['"]/g, '').trim() || '';
    const { originId, destinationId, productId } = req.query;

    const conditions = [];
    if (originId) conditions.push(eq(transfers.originId, originId as string));
    if (destinationId) conditions.push(eq(transfers.destinationId, destinationId as string));
    if (productId) conditions.push(eq(transfers.productId, productId as string));
    if (search) conditions.push(ilike(products.name, `%${search}%`));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const [{ total }] = await db.select({ total: count() }).from(transfers).where(whereClause);

    const allTransfers = await db.select({
      id: transfers.id,
      productId: transfers.productId,
      originId: transfers.originId,
      destinationId: transfers.destinationId,
      quantity: transfers.quantity,
      userId: transfers.userId,
      createdAt: transfers.createdAt,
      product: {
        id: products.id,
        name: products.name,
        productType: products.productType,
        measurement: products.measurement,
      },
      origin: {
        id: warehouses.id,
        name: warehouses.name,
      },
      destination: {
        id: warehouses.id,
        name: warehouses.name,
      },
      user: {
        id: users.id,
        name: users.name,
      },
    })
      .from(transfers)
      .innerJoin(products, eq(transfers.productId, products.id))
      .innerJoin(warehouses, eq(transfers.originId, warehouses.id))
      .innerJoin(warehouses, eq(transfers.destinationId, warehouses.id))
      .innerJoin(users, eq(transfers.userId, users.id))
      .where(whereClause)
      .limit(limit)
      .offset(offset);

    res.json({
      data: allTransfers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching transfers' });
  }
});

// POST /api/transfers
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { productId, originId, destinationId, quantity } = req.body;

    if (!productId || !originId || !destinationId || !quantity) {
      res.status(400).json({ message: 'All fields are required' });
      return;
    }

    if (originId === destinationId) {
      res.status(400).json({ message: 'Origin and destination cannot be the same' });
      return;
    }

    const result = await db.transaction(async (tx) => {
      // Check stock in origin
      const [stockOrigin] = await tx.select().from(stock)
        .where(and(eq(stock.warehouseId, originId), eq(stock.productId, productId)));

      if (!stockOrigin || stockOrigin.quantity < quantity) {
        throw new Error('Insufficient stock in origin');
      }

      // Subtract from origin
      await tx.update(stock)
        .set({ quantity: stockOrigin.quantity - quantity })
        .where(and(eq(stock.warehouseId, originId), eq(stock.productId, productId)));

      // Check stock in destination
      const [stockDestination] = await tx.select().from(stock)
        .where(and(eq(stock.warehouseId, destinationId), eq(stock.productId, productId)));

      if (stockDestination) {
        // Update destination
        await tx.update(stock)
          .set({ quantity: stockDestination.quantity + quantity })
          .where(and(eq(stock.warehouseId, destinationId), eq(stock.productId, productId)));
      } else {
        // Create new stock in destination
        await tx.insert(stock).values({ warehouseId: destinationId, productId, quantity });
      }

      // Create transfer record
      const [newTransfer] = await tx.insert(transfers)
        .values({ productId, originId, destinationId, quantity, userId: req.user!.userId })
        .returning();

      return newTransfer;
    });

    res.status(201).json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message || 'Error creating transfer' });
  }
});

export default router;

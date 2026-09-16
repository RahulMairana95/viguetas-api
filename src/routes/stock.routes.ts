import { Router, Request, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { stock, warehouses, products } from '../db/schema';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);

// GET /api/stock
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { warehouseId, productId } = req.query;

    const conditions = [];
    if (warehouseId) conditions.push(eq(stock.warehouseId, warehouseId as string));
    if (productId) conditions.push(eq(stock.productId, productId as string));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const stocks = await db.select({
      warehouseId: stock.warehouseId,
      productId: stock.productId,
      quantity: stock.quantity,
      warehouse: {
        id: warehouses.id,
        name: warehouses.name,
        type: warehouses.type,
      },
      product: {
        id: products.id,
        name: products.name,
        material: products.material,
        measurement: products.measurement,
      },
    })
      .from(stock)
      .innerJoin(warehouses, eq(stock.warehouseId, warehouses.id))
      .innerJoin(products, eq(stock.productId, products.id))
      .where(whereClause);

    res.json(stocks);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching stock' });
  }
});

// GET /api/stock/:warehouseId/:productId
router.get('/:warehouseId/:productId', async (req: Request, res: Response): Promise<void> => {
  try {
    const [stockItem] = await db.select({
      warehouseId: stock.warehouseId,
      productId: stock.productId,
      quantity: stock.quantity,
      warehouse: {
        id: warehouses.id,
        name: warehouses.name,
        type: warehouses.type,
      },
      product: {
        id: products.id,
        name: products.name,
        material: products.material,
        measurement: products.measurement,
      },
    })
      .from(stock)
      .innerJoin(warehouses, eq(stock.warehouseId, warehouses.id))
      .innerJoin(products, eq(stock.productId, products.id))
      .where(and(
        eq(stock.warehouseId, req.params.warehouseId),
        eq(stock.productId, req.params.productId)
      ));

    if (!stockItem) {
      res.status(404).json({ message: 'Stock not found' });
      return;
    }

    res.json(stockItem);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching stock' });
  }
});

// POST /api/stock (upsert)
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { warehouseId, productId, quantity } = req.body;

    if (!warehouseId || !productId || quantity === undefined) {
      res.status(400).json({ message: 'warehouseId, productId and quantity are required' });
      return;
    }

    // Check if stock exists
    const [existing] = await db.select().from(stock)
      .where(and(eq(stock.warehouseId, warehouseId), eq(stock.productId, productId)));

    let result;
    if (existing) {
      [result] = await db.update(stock)
        .set({ quantity })
        .where(and(eq(stock.warehouseId, warehouseId), eq(stock.productId, productId)))
        .returning();
    } else {
      [result] = await db.insert(stock)
        .values({ warehouseId, productId, quantity })
        .returning();
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error updating stock' });
  }
});

export default router;

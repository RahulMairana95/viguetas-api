import { Router, Request, Response } from 'express';
import { eq, count, ilike, desc } from 'drizzle-orm';
import { db } from '../db';
import { products } from '../db/schema';
import { authMiddleware, roleMiddleware } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

// GET /api/products?search=...
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const search = (req.query.search as string)?.replace(/['"]/g, '').trim() || '';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const whereClause = search ? ilike(products.name, `%${search}%`) : undefined;

    const [{ total }] = await db.select({ total: count() }).from(products).where(whereClause);
    const data = await db.select().from(products).where(whereClause).orderBy(desc(products.updatedAt)).limit(limit).offset(offset);

    res.json({
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching products' });
  }
});

// GET /api/products/:id
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const [product] = await db.select().from(products).where(eq(products.id, id));

    if (!product) {
      res.status(404).json({ message: 'Product not found' });
      return;
    }

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching product' });
  }
});

// POST /api/products
router.post('/', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, productType, measurement, price, description } = req.body;

    if (!name || !productType || !measurement) {
      res.status(400).json({ message: 'Name, productType and measurement are required' });
      return;
    }

    if (!['vigueta', 'plastoformo'].includes(productType)) {
      res.status(400).json({ message: 'productType must be vigueta or plastoformo' });
      return;
    }

    const [product] = await db.insert(products)
      .values({ name, productType, measurement, price, description })
      .returning();

    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error creating product' });
  }
});

// PUT /api/products/:id
router.put('/:id', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { name, productType, measurement, price, description } = req.body;

    if (productType && !['vigueta', 'plastoformo'].includes(productType)) {
      res.status(400).json({ message: 'productType must be vigueta or plastoformo' });
      return;
    }

    const [product] = await db.update(products)
      .set({ name, productType, measurement, price, description, updatedAt: new Date() })
      .where(eq(products.id, id))
      .returning();

    if (!product) {
      res.status(404).json({ message: 'Product not found' });
      return;
    }

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error updating product' });
  }
});

// DELETE /api/products/:id
router.delete('/:id', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    await db.delete(products).where(eq(products.id, id));
    res.json({ message: 'Product deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting product' });
  }
});

export default router;

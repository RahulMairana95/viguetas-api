import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { products } from '../db/schema';
import { authMiddleware, roleMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);

// GET /api/products
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const allProducts = await db.select().from(products);
    res.json(allProducts);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching products' });
  }
});

// GET /api/products/:id
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const [product] = await db.select().from(products).where(eq(products.id, req.params.id));

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
    const { name, material, measurement } = req.body;

    if (!name || !material || !measurement) {
      res.status(400).json({ message: 'Name, material and measurement are required' });
      return;
    }

    const [product] = await db.insert(products).values({ name, material, measurement }).returning();

    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error creating product' });
  }
});

// PUT /api/products/:id
router.put('/:id', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, material, measurement } = req.body;

    const [product] = await db.update(products)
      .set({ name, material, measurement })
      .where(eq(products.id, req.params.id))
      .returning();

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error updating product' });
  }
});

// DELETE /api/products/:id
router.delete('/:id', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    await db.delete(products).where(eq(products.id, req.params.id));
    res.json({ message: 'Product deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting product' });
  }
});

export default router;

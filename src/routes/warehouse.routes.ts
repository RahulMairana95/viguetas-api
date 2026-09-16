import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { warehouses } from '../db/schema';
import { authMiddleware, roleMiddleware } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

// GET /api/warehouses
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const allWarehouses = await db.select().from(warehouses);
    res.json(allWarehouses);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching warehouses' });
  }
});

// GET /api/warehouses/:id
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const [warehouse] = await db.select().from(warehouses).where(eq(warehouses.id, id));

    if (!warehouse) {
      res.status(404).json({ message: 'Warehouse not found' });
      return;
    }

    res.json(warehouse);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching warehouse' });
  }
});

// POST /api/warehouses
router.post('/', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, type } = req.body;

    if (!name || !type) {
      res.status(400).json({ message: 'Name and type are required' });
      return;
    }

    if (!['factory', 'store'].includes(type)) {
      res.status(400).json({ message: 'Type must be factory or store' });
      return;
    }

    const [warehouse] = await db.insert(warehouses).values({ name, type }).returning();

    res.status(201).json(warehouse);
  } catch (error) {
    res.status(500).json({ message: 'Error creating warehouse' });
  }
});

// PUT /api/warehouses/:id
router.put('/:id', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { name, type } = req.body;

    const [warehouse] = await db.update(warehouses)
      .set({ name, type })
      .where(eq(warehouses.id, id))
      .returning();

    res.json(warehouse);
  } catch (error) {
    res.status(500).json({ message: 'Error updating warehouse' });
  }
});

// DELETE /api/warehouses/:id
router.delete('/:id', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    await db.delete(warehouses).where(eq(warehouses.id, id));
    res.json({ message: 'Warehouse deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting warehouse' });
  }
});

export default router;

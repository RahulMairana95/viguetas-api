import { Router, Request, Response } from 'express';
import { eq, count, ilike, or, desc } from 'drizzle-orm';
import { db } from '../db';
import { warehouses } from '../db/schema';
import { authMiddleware, roleMiddleware } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

// GET /api/warehouses?search=...
router.get('/', roleMiddleware('admin', 'promoter'), async (req: Request, res: Response): Promise<void> => {
  try {
    const search = (req.query.search as string)?.replace(/['"]/g, '').trim() || '';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const whereClause = search ? or(
      ilike(warehouses.name, `%${search}%`)
    ) : undefined;

    const [{ total }] = await db.select({ total: count() }).from(warehouses).where(whereClause);
    const data = await db.select().from(warehouses).where(whereClause).orderBy(desc(warehouses.updatedAt)).limit(limit).offset(offset);

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
    res.status(500).json({ message: 'Error fetching warehouses' });
  }
});

// GET /api/warehouses/:id
router.get('/:id', roleMiddleware('admin', 'promoter'), async (req: Request, res: Response): Promise<void> => {
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
    const { name, type, address } = req.body;
    const telefono = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';

    if (!name || !type) {
      res.status(400).json({ message: 'Name and type are required' });
      return;
    }

    if (!['factory', 'store'].includes(type)) {
      res.status(400).json({ message: 'Type must be factory or store' });
      return;
    }

    if (telefono && !/^[0-9+\s()-]{6,20}$/.test(telefono)) {
      res.status(400).json({ error: 'El teléfono solo puede contener números, espacios, +, - y paréntesis' });
      return;
    }

    const [warehouse] = await db.insert(warehouses).values({ name, type, address, phone: telefono || null }).returning();

    res.status(201).json(warehouse);
  } catch (error) {
    res.status(500).json({ message: 'Error creating warehouse' });
  }
});

// PUT /api/warehouses/:id
router.put('/:id', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { name, type, address } = req.body;
    const telefono = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';

    if (telefono && !/^[0-9+\s()-]{6,20}$/.test(telefono)) {
      res.status(400).json({ error: 'El teléfono solo puede contener números, espacios, +, - y paréntesis' });
      return;
    }

    const [warehouse] = await db.update(warehouses)
      .set({ name, type, address, phone: telefono || null, updatedAt: new Date() })
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

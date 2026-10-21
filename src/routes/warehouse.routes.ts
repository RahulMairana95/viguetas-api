import { Router, Request, Response } from 'express';
import { eq, count, ilike, or, asc, sql } from 'drizzle-orm';
import { db } from '../db';
import { warehouses, users } from '../db/schema';
import { requireAuth, requireRole } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(requireAuth);

// GET /api/warehouses?search=...
// Lectura abierta a promoter: los formularios de Ventas y Stock la necesitan.
router.get('/', requireRole('admin', 'promoter'), async (req: Request, res: Response): Promise<void> => {
  try {
    const search = (req.query.search as string)?.replace(/['"]/g, '').trim() || '';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const whereClause = search ? or(
      ilike(warehouses.name, `%${search}%`)
    ) : undefined;

    const [{ total }] = await db.select({ total: count() }).from(warehouses).where(whereClause);
    // Fábrica primero y luego las tiendas (al revés sería fácil elegir mal el
    // origen de una línea y quedar sin saber de dónde recoger).
    const data = await db.select().from(warehouses)
      .where(whereClause)
      .orderBy(
        sql`case when ${warehouses.type} = 'factory' then 0 else 1 end`,
        asc(warehouses.name)
      )
      .limit(limit).offset(offset);

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
router.get('/:id', requireRole('admin', 'promoter'), async (req: Request, res: Response): Promise<void> => {
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
router.post('/', requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
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
//
// No se puede cambiar el tipo de un almacén que tiene usuarios asignados:
// los dejaría con un rol incompatible con su almacén.
router.put('/:id', requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { name, type, address } = req.body;
    const telefono = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';

    if (telefono && !/^[0-9+\s()-]{6,20}$/.test(telefono)) {
      res.status(400).json({ error: 'El teléfono solo puede contener números, espacios, +, - y paréntesis' });
      return;
    }

    const [almacenActual] = await db.select().from(warehouses).where(eq(warehouses.id, id));
    if (!almacenActual) {
      res.status(404).json({ message: 'Warehouse not found' });
      return;
    }

    if (type && type !== almacenActual.type) {
      if (!['factory', 'store'].includes(type)) {
        res.status(400).json({ message: 'Type must be factory or store' });
        return;
      }
      const asignados = await db.select({ id: users.id }).from(users).where(eq(users.warehouseId, id));
      if (asignados.length > 0) {
        res.status(400).json({ message: 'No puedes cambiar el tipo de un almacén que tiene usuarios asignados' });
        return;
      }
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
router.delete('/:id', requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const asignados = await db.select({ id: users.id }).from(users).where(eq(users.warehouseId, id));
    if (asignados.length > 0) {
      res.status(400).json({ message: 'No puedes eliminar un almacén que tiene usuarios asignados' });
      return;
    }

    await db.delete(warehouses).where(eq(warehouses.id, id));
    res.json({ message: 'Warehouse deleted' });
  } catch (error: any) {
    // 23503: tiene stock, ventas u otros registros asociados
    if ((error?.code ?? error?.cause?.code) === '23503') {
      res.status(409).json({ message: 'Este almacén tiene registros asociados y no se puede eliminar' });
      return;
    }
    res.status(500).json({ message: 'Error deleting warehouse' });
  }
});

export default router;

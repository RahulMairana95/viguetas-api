import { Router, Request, Response } from 'express';
import { eq, and, count, ilike, asc, desc } from 'drizzle-orm';
import { db } from '../db';
import { puntales } from '../db/schema';
import { authMiddleware, roleMiddleware } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

const MATERIALS = ['madera', 'metal', 'solera'] as const;
const STATUSES = ['en_obra', 'en_almacen'] as const;

type PuntalMaterial = (typeof MATERIALS)[number];
type PuntalStatus = (typeof STATUSES)[number];

/**
 * Convierte 'YYYY-MM-DD' (o un ISO completo) en Date a mediodía UTC.
 * Mediodía UTC garantiza que al leerlo en el navegador se muestre SIEMPRE
 * el mismo día calendario, sin desfases por zona horaria.
 */
function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return new Date(`${day}T12:00:00.000Z`);
}

interface PuntalInput {
  clientName: string;
  loanDate: Date;
  pickupDate: Date;
  material: PuntalMaterial;
  quantity: number;
  place: string;
  description: string | null;
  status: PuntalStatus;
}

/** Valida el cuerpo de create/update y devuelve el payload normalizado. */
function readPuntal(body: Record<string, unknown>): { error: string } | { input: PuntalInput } {
  const clientName = String(body.clientName ?? '').trim();
  if (!clientName) return { error: 'El cliente es requerido' };
  if (clientName.length > 255) return { error: 'El cliente no puede exceder 255 caracteres' };

  const loanDate = parseDateOnly(body.loanDate);
  if (!loanDate) return { error: 'La fecha de préstamo es requerida' };

  const pickupDate = parseDateOnly(body.pickupDate);
  if (!pickupDate) return { error: 'La fecha de recojo es requerida' };
  if (pickupDate.getTime() < loanDate.getTime()) {
    return { error: 'La fecha de recojo debe ser igual o posterior a la fecha de préstamo' };
  }

  const material = body.material as PuntalMaterial;
  if (!MATERIALS.includes(material)) {
    return { error: 'Material must be madera, metal or solera' };
  }

  const quantity = body.quantity;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
    return { error: 'La cantidad debe ser un número entero mayor a cero' };
  }

  const place = String(body.place ?? '').trim();
  if (!place) return { error: 'El lugar es requerido' };
  if (place.length > 500) return { error: 'El lugar no puede exceder 500 caracteres' };

  const rawDescription = body.description;
  const description =
    rawDescription === null || rawDescription === undefined || rawDescription === ''
      ? null
      : String(rawDescription);
  if (description && description.length > 1000) {
    return { error: 'La descripción no puede exceder 1000 caracteres' };
  }

  const status = (body.status ?? 'en_obra') as PuntalStatus;
  if (!STATUSES.includes(status)) return { error: 'Status must be en_obra or en_almacen' };

  return {
    input: { clientName, loanDate, pickupDate, material, quantity, place, description, status },
  };
}

// GET /api/puntales?search=...&status=...
//
// Registro independiente: no se une con clients ni con ninguna otra tabla.
// `search` busca por cliente; `status` filtra por estado ('all' = sin filtro).
router.get('/', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const search = (req.query.search as string)?.replace(/['"]/g, '').trim() || '';
    const { status } = req.query;

    const conditions = [];
    if (status && status !== 'all') {
      if (!STATUSES.includes(status as PuntalStatus)) {
        res.status(400).json({ message: 'Status must be en_obra, en_almacen or all' });
        return;
      }
      conditions.push(eq(puntales.status, status as PuntalStatus));
    }
    if (search) conditions.push(ilike(puntales.clientName, `%${search}%`));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const [{ total }] = await db.select({ total: count() }).from(puntales).where(whereClause);

    // Orden por fecha de recojo: los préstamos vencidos quedan a la vista primero
    const data = await db
      .select()
      .from(puntales)
      .where(whereClause)
      .orderBy(asc(puntales.pickupDate), desc(puntales.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching puntales' });
  }
});

// GET /api/puntales/:id
router.get('/:id', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const [puntal] = await db.select().from(puntales).where(eq(puntales.id, req.params.id as string));

    if (!puntal) {
      res.status(404).json({ message: 'Puntal not found' });
      return;
    }

    res.json(puntal);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching puntal' });
  }
});

// POST /api/puntales — Nuevo préstamo
router.post('/', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const result = readPuntal(req.body);
    if ('error' in result) {
      res.status(400).json({ message: result.error });
      return;
    }

    const [puntal] = await db.insert(puntales).values(result.input).returning();

    res.status(201).json(puntal);
  } catch (error) {
    res.status(500).json({ message: 'Error creating puntal' });
  }
});

// PUT /api/puntales/:id — Editar préstamo completo
router.put('/:id', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const result = readPuntal(req.body);
    if ('error' in result) {
      res.status(400).json({ message: result.error });
      return;
    }

    const [puntal] = await db
      .update(puntales)
      .set({ ...result.input, updatedAt: new Date() })
      .where(eq(puntales.id, id))
      .returning();

    if (!puntal) {
      res.status(404).json({ message: 'Puntal not found' });
      return;
    }

    res.json(puntal);
  } catch (error) {
    res.status(500).json({ message: 'Error updating puntal' });
  }
});

// PATCH /api/puntales/:id/status — Cambiar solo el estado (En obra / En Almacén)
router.patch(
  '/:id/status',
  roleMiddleware('admin'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = req.params.id as string;
      const status = req.body?.status as PuntalStatus;

      if (!status || !STATUSES.includes(status)) {
        res.status(400).json({ message: 'Status must be en_obra or en_almacen' });
        return;
      }

      const [puntal] = await db
        .update(puntales)
        .set({ status, updatedAt: new Date() })
        .where(eq(puntales.id, id))
        .returning();

      if (!puntal) {
        res.status(404).json({ message: 'Puntal not found' });
        return;
      }

      res.json(puntal);
    } catch (error) {
      res.status(500).json({ message: 'Error updating puntal status' });
    }
  }
);

export default router;

import { Router, Request, Response } from 'express';
import { eq, and, count, ilike, or, desc } from 'drizzle-orm';
import { db } from '../db';
import { productions, products, orders, users, stock, warehouses } from '../db/schema';
import { authMiddleware, roleMiddleware } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

// GET /api/productions?search=...
router.get('/', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
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

    const [{ total }] = await db.select({ total: count() })
      .from(productions)
      .innerJoin(products, eq(productions.productId, products.id))
      .where(whereClause);

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
      .orderBy(desc(productions.updatedAt))
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

    if (!productId || typeof quantity !== 'number' ||
        !Number.isInteger(quantity) || quantity <= 0) {
      res.status(400).json({ message: 'productId y quantity (entera mayor a cero) son requeridos' });
      return;
    }

    if (orderId) {
      const [pedido] = await db.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId));
      if (!pedido) {
        res.status(400).json({ message: 'El pedido indicado no existe' });
        return;
      }
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

    const result = await db.transaction(async (tx) => {
      // Bloquea el registro (FOR UPDATE) para que dos completados
      // simultáneos no sumen el stock dos veces.
      const [production] = await tx.select().from(productions)
        .where(eq(productions.id, id))
        .for('update');

      if (!production) {
        throw new Error('NOT_FOUND');
      }

      if (production.status === 'completed') {
        throw new Error('ALREADY_COMPLETED');
      }

      // Suma la producción al stock del almacén de tipo fábrica
      const [factory] = await tx.select().from(warehouses)
        .where(eq(warehouses.type, 'factory'));

      if (!factory) {
        throw new Error('NO_FACTORY');
      }

      const [existingStock] = await tx.select().from(stock)
        .where(and(eq(stock.warehouseId, factory.id), eq(stock.productId, production.productId)));

      if (existingStock) {
        await tx.update(stock)
          .set({ quantity: existingStock.quantity + production.quantity, updatedAt: new Date() })
          .where(and(eq(stock.warehouseId, factory.id), eq(stock.productId, production.productId)));
      } else {
        await tx.insert(stock)
          .values({
            warehouseId: factory.id,
            productId: production.productId,
            quantity: production.quantity,
          });
      }

      const [updated] = await tx.update(productions)
        .set({ status: 'completed', updatedAt: new Date() })
        .where(eq(productions.id, id))
        .returning();

      return updated;
    });

    res.json(result);
  } catch (error: any) {
    if (error?.message === 'NOT_FOUND') {
      res.status(404).json({ message: 'Registro de producción no encontrado' });
      return;
    }
    if (error?.message === 'ALREADY_COMPLETED') {
      res.status(400).json({ message: 'Este registro ya fue marcado como completado' });
      return;
    }
    if (error?.message === 'NO_FACTORY') {
      res.status(400).json({ message: 'No existe un almacén de tipo fábrica configurado' });
      return;
    }
    console.error('Error completing production:', error);
    res.status(500).json({ message: 'No se pudo completar el registro de producción' });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { eq, count, ilike, or, desc } from 'drizzle-orm';
import { db } from '../db';
import { clients, sales, saleItems, products } from '../db/schema';
import { requireAuth, requireRole } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(requireAuth);

// GET /api/clients?search=...
router.get('/', requireRole('admin', 'promoter'), async (req: Request, res: Response): Promise<void> => {
  try {
    const search = (req.query.search as string)?.replace(/['"]/g, '').trim() || '';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const whereClause = search ? or(
      ilike(clients.name, `%${search}%`),
      ilike(clients.phone, `%${search}%`)
    ) : undefined;

    const [{ total }] = await db.select({ total: count() }).from(clients).where(whereClause);
    const data = await db.select().from(clients).where(whereClause).orderBy(desc(clients.updatedAt)).limit(limit).offset(offset);

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
    res.status(500).json({ message: 'Error fetching clients' });
  }
});

// GET /api/clients/:id — el detalle incluye las ventas del cliente
router.get('/:id', requireRole('admin', 'promoter'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const [client] = await db.select().from(clients).where(eq(clients.id, id));

    if (!client) {
      res.status(404).json({ message: 'Client not found' });
      return;
    }

    const clientSales = await db.select({
      id: sales.id,
      status: sales.status,
      deliveryDate: sales.deliveryDate,
      deliveryPlace: sales.deliveryPlace,
      deliveredAt: sales.deliveredAt,
      date: sales.date,
    })
      .from(sales)
      .where(eq(sales.clientId, id))
      .orderBy(desc(sales.date));

    const salesWithItems = await Promise.all(
      clientSales.map(async (sale) => {
        const items = await db.select({
          id: saleItems.id,
          quantity: saleItems.quantity,
          unitPrice: saleItems.unitPrice,
          product: {
            id: products.id,
            name: products.name,
            productType: products.productType,
            longitud: products.longitud,
            grosor: products.grosor,
            ancho: products.ancho,
            largo: products.largo,
          },
        })
          .from(saleItems)
          .innerJoin(products, eq(saleItems.productId, products.id))
          .where(eq(saleItems.saleId, sale.id));

        return { ...sale, items };
      })
    );

    res.json({ ...client, sales: salesWithItems });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching client' });
  }
});

// POST /api/clients — promoter también puede registrar clientes
router.post('/', requireRole('admin', 'promoter'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, phone } = req.body;

    if (!name) {
      res.status(400).json({ message: 'Name is required' });
      return;
    }

    const [client] = await db.insert(clients).values({ name, phone }).returning();

    res.status(201).json(client);
  } catch (error) {
    res.status(500).json({ message: 'Error creating client' });
  }
});

// PUT /api/clients/:id
router.put('/:id', requireRole('admin', 'promoter'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { name, phone } = req.body;

    const [client] = await db.update(clients)
      .set({ name, phone, updatedAt: new Date() })
      .where(eq(clients.id, id))
      .returning();

    res.json(client);
  } catch (error) {
    res.status(500).json({ message: 'Error updating client' });
  }
});

// DELETE /api/clients/:id
router.delete('/:id', requireRole('admin', 'promoter'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    await db.delete(clients).where(eq(clients.id, id));
    res.json({ message: 'Client deleted' });
  } catch (error: any) {
    // 23503: el cliente tiene ventas registradas
    if ((error?.code ?? error?.cause?.code) === '23503') {
      res.status(409).json({ message: 'Este cliente tiene ventas registradas y no se puede eliminar' });
      return;
    }
    res.status(500).json({ message: 'Error deleting client' });
  }
});

export default router;

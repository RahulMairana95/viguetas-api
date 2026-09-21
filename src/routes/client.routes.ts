import { Router, Request, Response } from 'express';
import { eq, count, ilike, or } from 'drizzle-orm';
import { db } from '../db';
import { clients, orders, orderItems, products } from '../db/schema';
import { authMiddleware } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

// GET /api/clients?search=...
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const search = (req.query.search as string) || '';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const whereClause = search ? or(
      ilike(clients.name, `%${search}%`),
      ilike(clients.phone, `%${search}%`)
    ) : undefined;

    const [{ total }] = await db.select({ total: count() }).from(clients).where(whereClause);
    const data = await db.select().from(clients).where(whereClause).limit(limit).offset(offset);

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

// GET /api/clients/:id
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const [client] = await db.select().from(clients).where(eq(clients.id, id));

    if (!client) {
      res.status(404).json({ message: 'Client not found' });
      return;
    }

    // Get client orders
    const clientOrders = await db.select({
      id: orders.id,
      deliveryPlace: orders.deliveryPlace,
      deliveryDate: orders.deliveryDate,
      status: orders.status,
      createdAt: orders.createdAt,
    })
      .from(orders)
      .where(eq(orders.clientId, id));

    // Get order items for each order
    const ordersWithItems = await Promise.all(
      clientOrders.map(async (order) => {
        const items = await db.select({
          id: orderItems.id,
          quantity: orderItems.quantity,
          product: {
            id: products.id,
            name: products.name,
            productType: products.productType,
            measurement: products.measurement,
          },
        })
          .from(orderItems)
          .innerJoin(products, eq(orderItems.productId, products.id))
          .where(eq(orderItems.orderId, order.id));

        return { ...order, items };
      })
    );

    res.json({ ...client, orders: ordersWithItems });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching client' });
  }
});

// POST /api/clients
router.post('/', async (req: Request, res: Response): Promise<void> => {
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
router.put('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { name, phone } = req.body;

    const [client] = await db.update(clients)
      .set({ name, phone })
      .where(eq(clients.id, id))
      .returning();

    res.json(client);
  } catch (error) {
    res.status(500).json({ message: 'Error updating client' });
  }
});

// DELETE /api/clients/:id
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    await db.delete(clients).where(eq(clients.id, id));
    res.json({ message: 'Client deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting client' });
  }
});

export default router;

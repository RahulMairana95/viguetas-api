import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { clients, orders, orderItems, products } from '../db/schema';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);

// GET /api/clients
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const allClients = await db.select().from(clients);
    res.json(allClients);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching clients' });
  }
});

// GET /api/clients/:id
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const [client] = await db.select().from(clients).where(eq(clients.id, req.params.id));

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
      .where(eq(orders.clientId, req.params.id));

    // Get order items for each order
    const ordersWithItems = await Promise.all(
      clientOrders.map(async (order) => {
        const items = await db.select({
          id: orderItems.id,
          quantity: orderItems.quantity,
          product: {
            id: products.id,
            name: products.name,
            material: products.material,
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
    const { name, phone } = req.body;

    const [client] = await db.update(clients)
      .set({ name, phone })
      .where(eq(clients.id, req.params.id))
      .returning();

    res.json(client);
  } catch (error) {
    res.status(500).json({ message: 'Error updating client' });
  }
});

// DELETE /api/clients/:id
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    await db.delete(clients).where(eq(clients.id, req.params.id));
    res.json({ message: 'Client deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting client' });
  }
});

export default router;

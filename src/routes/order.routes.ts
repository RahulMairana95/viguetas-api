import { Router, Request, Response } from 'express';
import { eq, and, count, ilike, or, desc } from 'drizzle-orm';
import { db } from '../db';
import { orders, orderItems, clients, products, users, productions } from '../db/schema';
import { authMiddleware, roleMiddleware } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

// GET /api/orders?search=...
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const search = (req.query.search as string)?.replace(/['"]/g, '').trim() || '';
    const { status, clientId } = req.query;

    const conditions = [];
    if (status) conditions.push(eq(orders.status, status as 'pending' | 'completed' | 'cancelled'));
    if (clientId) conditions.push(eq(orders.clientId, clientId as string));
    if (search) conditions.push(or(
      ilike(orders.deliveryPlace, `%${search}%`),
      ilike(clients.name, `%${search}%`)
    ));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const [{ total }] = await db.select({ total: count() }).from(orders).where(whereClause);

    const allOrders = await db.select({
      id: orders.id,
      clientId: orders.clientId,
      deliveryPlace: orders.deliveryPlace,
      deliveryDate: orders.deliveryDate,
      status: orders.status,
      createdAt: orders.createdAt,
      client: {
        id: clients.id,
        name: clients.name,
        phone: clients.phone,
      },
      user: {
        id: users.id,
        name: users.name,
      },
    })
      .from(orders)
      .innerJoin(clients, eq(orders.clientId, clients.id))
      .innerJoin(users, eq(orders.userId, users.id))
      .where(whereClause)
      .orderBy(desc(orders.updatedAt))
      .limit(limit)
      .offset(offset);

    // Get items for each order
    const ordersWithItems = await Promise.all(
      allOrders.map(async (order) => {
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

    res.json({
      data: ordersWithItems,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching orders' });
  }
});

// GET /api/orders/:id
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const [order] = await db.select({
      id: orders.id,
      clientId: orders.clientId,
      deliveryPlace: orders.deliveryPlace,
      deliveryDate: orders.deliveryDate,
      status: orders.status,
      createdAt: orders.createdAt,
      client: {
        id: clients.id,
        name: clients.name,
        phone: clients.phone,
      },
      user: {
        id: users.id,
        name: users.name,
      },
    })
      .from(orders)
      .innerJoin(clients, eq(orders.clientId, clients.id))
      .innerJoin(users, eq(orders.userId, users.id))
      .where(eq(orders.id, id));

    if (!order) {
      res.status(404).json({ message: 'Order not found' });
      return;
    }

    // Get order items
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
      .where(eq(orderItems.orderId, id));

    // Get productions for this order
    const orderProductions = await db.select().from(productions)
      .where(eq(productions.orderId, id));

    res.json({ ...order, items, productions: orderProductions });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching order' });
  }
});

// POST /api/orders
router.post('/', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientId, deliveryPlace, deliveryDate, items } = req.body;

    if (!clientId || !deliveryPlace || !deliveryDate || !items?.length) {
      res.status(400).json({ message: 'clientId, deliveryPlace, deliveryDate and items are required' });
      return;
    }

    const result = await db.transaction(async (tx) => {
      // Create order
      const [order] = await tx.insert(orders)
        .values({
          clientId,
          deliveryPlace,
          deliveryDate: new Date(deliveryDate),
          userId: req.user!.userId,
        })
        .returning();

      // Create order items
      const orderItemsResult = await tx.insert(orderItems)
        .values(items.map((item: { productId: string; quantity: number }) => ({
          orderId: order.id,
          productId: item.productId,
          quantity: item.quantity,
        })))
        .returning();

      return { ...order, items: orderItemsResult };
    });

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error creating order' });
  }
});

// PATCH /api/orders/:id/status
router.patch('/:id/status', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { status } = req.body;

    if (!status) {
      res.status(400).json({ message: 'Status is required' });
      return;
    }

    if (!['pending', 'completed', 'cancelled'].includes(status)) {
      res.status(400).json({ message: 'Status must be pending, completed or cancelled' });
      return;
    }

    const [order] = await db.update(orders)
      .set({ status, updatedAt: new Date() })
      .where(eq(orders.id, id))
      .returning();

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: 'Error updating order status' });
  }
});

export default router;

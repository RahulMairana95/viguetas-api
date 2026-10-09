import { Router, Request, Response } from 'express';
import { eq, and, count, ilike, or, desc } from 'drizzle-orm';
import { db } from '../db';
import { orders, orderItems, clients, products, users, productions, sales, warehouses } from '../db/schema';
import { authMiddleware, roleMiddleware } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

// GET /api/orders?search=...
router.get('/', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
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

    const [{ total }] = await db.select({ total: count() })
      .from(orders)
      .innerJoin(clients, eq(orders.clientId, clients.id))
      .where(whereClause);

    const allOrders = await db.select({
      id: orders.id,
      clientId: orders.clientId,
      deliveryPlace: orders.deliveryPlace,
      deliveryDate: orders.deliveryDate,
      status: orders.status,
      advance: orders.advance,
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
          unitPrice: orderItems.unitPrice,
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

        return {
          ...order,
          items,
          total: items.reduce(
            (acc, item) => acc + (Number(item.unitPrice) || 0) * item.quantity,
            0
          ),
        };
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
router.get('/:id', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const [order] = await db.select({
      id: orders.id,
      clientId: orders.clientId,
      deliveryPlace: orders.deliveryPlace,
      deliveryDate: orders.deliveryDate,
      status: orders.status,
      advance: orders.advance,
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
      unitPrice: orderItems.unitPrice,
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

    const total = items.reduce(
      (acc, item) => acc + (Number(item.unitPrice) || 0) * item.quantity,
      0
    );

    // Get productions for this order
    const orderProductions = await db.select().from(productions)
      .where(eq(productions.orderId, id));

    // Get sales linked to this order
    const ventasVinculadas = await db.select({
      id: sales.id,
      clientId: sales.clientId,
      warehouseId: sales.warehouseId,
      date: sales.date,
      warehouseName: warehouses.name,
    })
      .from(sales)
      .innerJoin(warehouses, eq(sales.warehouseId, warehouses.id))
      .where(eq(sales.orderId, id));

    res.json({ ...order, items, total, productions: orderProductions, sales: ventasVinculadas });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching order' });
  }
});

// POST /api/orders
router.post('/', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { clientId, deliveryPlace, deliveryDate, items, advance } = req.body;

    if (!clientId || !deliveryPlace || !deliveryDate || !items?.length) {
      res.status(400).json({ message: 'clientId, deliveryPlace, deliveryDate and items are required' });
      return;
    }

    for (const item of items) {
      if (!item.productId || typeof item.quantity !== 'number' ||
          !Number.isInteger(item.quantity) || item.quantity <= 0) {
        res.status(400).json({ message: 'Cada línea debe tener productId y cantidad entera mayor a cero' });
        return;
      }
      if (item.unitPrice !== undefined && item.unitPrice !== null &&
          (typeof item.unitPrice !== 'number' || item.unitPrice < 0)) {
        res.status(400).json({ message: 'unitPrice debe ser un número mayor o igual a cero' });
        return;
      }
    }

    const advanceNumber = advance === undefined || advance === null || advance === ''
      ? 0
      : Number(advance);

    if (Number.isNaN(advanceNumber) || advanceNumber < 0) {
      res.status(400).json({ message: 'El adelanto debe ser un número mayor o igual a cero' });
      return;
    }

    const total = items.reduce(
      (acc: number, item: { quantity: number; unitPrice?: number | null }) =>
        acc + item.quantity * (item.unitPrice ?? 0),
      0
    );

    if (advanceNumber > total) {
      res.status(400).json({ message: 'El adelanto no puede ser mayor que el total del pedido' });
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
          advance: advanceNumber.toFixed(2),
        })
        .returning();

      // Create order items
      const orderItemsResult = await tx.insert(orderItems)
        .values(items.map((item: { productId: string; quantity: number; unitPrice?: number | null }) => ({
          orderId: order.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice:
            item.unitPrice !== undefined && item.unitPrice !== null
              ? Number(item.unitPrice).toFixed(2)
              : null,
        })))
        .returning();

      return { ...order, items: orderItemsResult, total };
    });

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error creating order' });
  }
});

// GET /api/orders/:id/sales — ventas vinculadas al pedido
router.get('/:id/sales', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const resultado = await db.select({
      id: sales.id,
      clientId: sales.clientId,
      warehouseId: sales.warehouseId,
      date: sales.date,
      warehouseName: warehouses.name,
    })
      .from(sales)
      .innerJoin(warehouses, eq(sales.warehouseId, warehouses.id))
      .where(eq(sales.orderId, id));

    res.json({ data: resultado });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching sales for order' });
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

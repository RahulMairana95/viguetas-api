import { Router, Request, Response } from 'express';
import { eq, and, count, ilike, or, asc, sum, inArray } from 'drizzle-orm';
import { db } from '../db';
import { orders, orderItems, clients, products, users, productions, sales, warehouses, stock, saleItems } from '../db/schema';
import { authMiddleware, roleMiddleware } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

// GET /api/orders?search=...
router.get('/', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const search = (req.query.search as string)?.replace(/['"]/g, '').trim() || '';
    const { status, clientId } = req.query;

    const conditions = [];
    // `status=all` (o vacío) = sin filtro de estado
    if (status && status !== 'all') {
      if (!['pending', 'completed', 'cancelled'].includes(status as string)) {
        res.status(400).json({ message: 'Status must be pending, completed, cancelled or all' });
        return;
      }
      conditions.push(eq(orders.status, status as 'pending' | 'completed' | 'cancelled'));
    }
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
      // Orden por defecto: fecha de entrega ascendente (de menor a mayor)
      .orderBy(asc(orders.deliveryDate), asc(orders.createdAt))
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
//
// Al completar un pedido se descuenta el stock pendiente del ALMACÉN DEL ADMINISTRADOR
// que cambia el estado (nunca de las demás tiendas ni de los promotores). Si el pedido
// ya tiene ventas vinculadas, solo se descuenta lo que esas ventas no cubrieron, así no
// se descuenta dos veces. Al reabrir (completed → pending/cancelled) se devuelve lo que
// descontó esta función y nada más (los pedidos antiguos, completados antes de existir
// este comportamiento, nunca se tocan).
router.patch('/:id/status', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const { status, settleBalance } = req.body;

  if (!status) {
    res.status(400).json({ message: 'Status is required' });
    return;
  }

  if (!['pending', 'completed', 'cancelled'].includes(status)) {
    res.status(400).json({ message: 'Status must be pending, completed or cancelled' });
    return;
  }

  // settleBalance = el cliente pagó el saldo pendiente: se guarda el total cobrado
  // (adelanto = total), por lo que el saldo que queda es 0.00.
  if (settleBalance !== undefined && typeof settleBalance !== 'boolean') {
    res.status(400).json({ message: 'settleBalance must be a boolean' });
    return;
  }

  const saldarSaldo = settleBalance === true;

  if (saldarSaldo && status !== 'completed') {
    res.status(400).json({ message: 'settleBalance only applies when completing the order' });
    return;
  }

  try {
    const resultado = await db.transaction(async (tx) => {
      const [pedido] = await tx.select().from(orders).where(eq(orders.id, id));
      if (!pedido) return null;

      const eraCompletado = pedido.status === 'completed';
      const seraCompletado = status === 'completed';

      // 'salida' = completar y descontar; 'entrada' = reabrir y devolver el stock
      const movimiento: 'salida' | 'entrada' | null = seraCompletado
        ? !eraCompletado && !pedido.stockDeducted ? 'salida' : null
        : eraCompletado && pedido.stockDeducted ? 'entrada' : null;

      let stockDeducted = pedido.stockDeducted;

      if (movimiento) {
        const [usuario] = await tx.select({ warehouseId: users.warehouseId })
          .from(users)
          .where(eq(users.id, req.user!.userId));

        if (!usuario?.warehouseId) {
          throw new Error(
            'Tu usuario no tiene un almacén asignado; pídele a un superadministrador que te asigne uno para completar pedidos.'
          );
        }
        const warehouseId = usuario.warehouseId;

        const lineas = await tx.select({
          productId: orderItems.productId,
          quantity: orderItems.quantity,
        })
          .from(orderItems)
          .where(eq(orderItems.orderId, id));

        // Cantidades ya despachadas por ventas vinculadas a este pedido
        const ventas = await tx.select({ productId: saleItems.productId, total: sum(saleItems.quantity) })
          .from(saleItems)
          .innerJoin(sales, eq(saleItems.saleId, sales.id))
          .where(eq(sales.orderId, id))
          .groupBy(saleItems.productId);
        const despachado = new Map(ventas.map((v) => [v.productId, Number(v.total) || 0]));

        const pendientePorProducto = new Map<string, number>();
        for (const linea of lineas) {
          const pendiente = linea.quantity - (despachado.get(linea.productId) ?? 0);
          if (pendiente > 0) {
            pendientePorProducto.set(
              linea.productId,
              (pendientePorProducto.get(linea.productId) ?? 0) + pendiente
            );
          }
        }

        if (pendientePorProducto.size > 0) {
          const catalogo = await tx.select({ id: products.id, name: products.name })
            .from(products)
            .where(inArray(products.id, [...pendientePorProducto.keys()]));
          const nombreDe = new Map(catalogo.map((p) => [p.id, p.name]));

          // Bloquear y validar TODO el stock antes de mover nada (evita carreras)
          const stocks = new Map<string, typeof stock.$inferSelect>();
          for (const [productId, cantidad] of pendientePorProducto) {
            const [actual] = await tx.select().from(stock)
              .where(and(eq(stock.warehouseId, warehouseId), eq(stock.productId, productId)))
              .for('update');

            if (movimiento === 'salida' && (!actual || actual.quantity < cantidad)) {
              throw new Error(
                `Stock insuficiente para "${nombreDe.get(productId) ?? 'un producto'}" en tu almacén: ` +
                  `hay ${actual?.quantity ?? 0} y el pedido necesita ${cantidad}.`
              );
            }
            if (actual) stocks.set(productId, actual);
          }

          for (const [productId, cantidad] of pendientePorProducto) {
            const actual = stocks.get(productId);

            if (actual) {
              const nuevaCantidad = movimiento === 'salida'
                ? actual.quantity - cantidad
                : actual.quantity + cantidad;
              await tx.update(stock)
                .set({ quantity: nuevaCantidad, updatedAt: new Date() })
                .where(and(eq(stock.warehouseId, warehouseId), eq(stock.productId, productId)));
            } else {
              // Solo puede faltar la fila al devolver stock: se crea con lo que se devuelve
              await tx.insert(stock).values({ warehouseId, productId, quantity: cantidad });
            }
          }
        }

        stockDeducted = movimiento === 'salida';
      }

      // Saldar el saldo pendiente: "una pequeña operación matemática" —
      // el adelanto pasa a ser el total del pedido, así el saldo resultante es 0.00.
      let advance = pedido.advance;
      if (saldarSaldo) {
        const lineas = await tx.select({
          quantity: orderItems.quantity,
          unitPrice: orderItems.unitPrice,
        })
          .from(orderItems)
          .where(eq(orderItems.orderId, id));

        const total = lineas.reduce(
          (acc, linea) => acc + (Number(linea.unitPrice) || 0) * linea.quantity,
          0
        );
        if (total > (Number(pedido.advance) || 0)) {
          advance = total.toFixed(2);
        }
      }

      const [actualizado] = await tx.update(orders)
        .set({ status, stockDeducted, advance, updatedAt: new Date() })
        .where(eq(orders.id, id))
        .returning();

      return actualizado;
    });

    if (!resultado) {
      res.status(404).json({ message: 'Order not found' });
      return;
    }

    res.json(resultado);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : '';
    if (mensaje.startsWith('Stock insuficiente') || mensaje.startsWith('Tu usuario no tiene')) {
      res.status(400).json({ message: mensaje });
      return;
    }
    res.status(500).json({ message: 'Error updating order status' });
  }
});

export default router;

import { Request, Response } from 'express';
import { db } from '../db';
import { stock, sales, saleItems, clients, products, warehouses, users } from '../db/schema';
import { eq, and, count, desc, inArray } from 'drizzle-orm';

type ItemVenta = { productId: string; quantity: number; unitPrice?: number | null };

export async function listSales(req: Request, res: Response): Promise<void> {
  try {
    const { warehouseId, clientId } = req.query;

    const condiciones = [];
    if (warehouseId) condiciones.push(eq(sales.warehouseId, warehouseId as string));
    if (clientId) condiciones.push(eq(sales.clientId, clientId as string));

    const whereClause = condiciones.length > 0 ? and(...condiciones) : undefined;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const [{ total }] = await db.select({ total: count() }).from(sales).where(whereClause);

    const ventas = await db.select({
      id: sales.id,
      clientId: sales.clientId,
      warehouseId: sales.warehouseId,
      userId: sales.userId,
      date: sales.date,
      client: {
        id: clients.id,
        name: clients.name,
      },
      warehouse: {
        id: warehouses.id,
        name: warehouses.name,
      },
      user: {
        id: users.id,
        name: users.name,
      },
    })
      .from(sales)
      .innerJoin(clients, eq(sales.clientId, clients.id))
      .innerJoin(warehouses, eq(sales.warehouseId, warehouses.id))
      .innerJoin(users, eq(sales.userId, users.id))
      .where(whereClause)
      .orderBy(desc(sales.date))
      .limit(limit)
      .offset(offset);

    let resultado: any[] = [];

    if (ventas.length > 0) {
      const items = await db.select({
        saleId: saleItems.saleId,
        productId: saleItems.productId,
        quantity: saleItems.quantity,
        unitPrice: saleItems.unitPrice,
        product: {
          id: products.id,
          name: products.name,
          productType: products.productType,
          measurement: products.measurement,
        },
      })
        .from(saleItems)
        .innerJoin(products, eq(saleItems.productId, products.id))
        .where(inArray(saleItems.saleId, ventas.map((v) => v.id)));

      resultado = ventas.map((venta) => {
        const lineas = items.filter((i) => i.saleId === venta.id);
        return {
          ...venta,
          items: lineas,
          total: lineas.reduce(
            (acc, i) => acc + (Number(i.unitPrice) || 0) * i.quantity,
            0
          ),
        };
      });
    }

    res.json({
      data: resultado,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching sales' });
  }
}

export async function createSale(req: Request, res: Response): Promise<void> {
  try {
    const { clientId, warehouseId, items } = req.body as {
      clientId: string;
      warehouseId: string;
      items: ItemVenta[];
    };

    if (!clientId || !warehouseId || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ message: 'clientId, warehouseId y al menos un producto son requeridos' });
      return;
    }

    for (const item of items) {
      if (!item.productId || typeof item.quantity !== 'number' ||
          !Number.isInteger(item.quantity) || item.quantity <= 0) {
        res.status(400).json({ message: 'Cada producto debe tener productId y cantidad entera mayor a cero' });
        return;
      }
      if (item.unitPrice !== undefined && item.unitPrice !== null &&
          (typeof item.unitPrice !== 'number' || item.unitPrice < 0)) {
        res.status(400).json({ message: 'unitPrice debe ser un número mayor o igual a cero' });
        return;
      }
    }

    // Acumula cantidades por producto para descontar stock (si un producto
    // aparece en varias líneas, se descuenta la suma una sola vez).
    const cantidades = new Map<string, number>();
    for (const item of items) {
      cantidades.set(item.productId, (cantidades.get(item.productId) ?? 0) + item.quantity);
    }

    const resultado = await db.transaction(async (tx) => {
      // 1. Bloquear y verificar el stock de TODOS los productos antes de
      //    descontar cualquiera (FOR UPDATE evita condiciones de carrera).
      const stocks = new Map<string, typeof stock.$inferSelect>();
      for (const [productId, cantidad] of cantidades) {
        const [stockActual] = await tx.select().from(stock)
          .where(and(eq(stock.warehouseId, warehouseId), eq(stock.productId, productId)))
          .for('update');

        if (!stockActual || stockActual.quantity < cantidad) {
          throw new Error('Stock insuficiente para uno de los productos seleccionados');
        }
        stocks.set(productId, stockActual);
      }

      // 2. Descontar stock de cada producto
      for (const [productId, cantidad] of cantidades) {
        const stockActual = stocks.get(productId)!;
        await tx.update(stock)
          .set({ quantity: stockActual.quantity - cantidad, updatedAt: new Date() })
          .where(and(eq(stock.warehouseId, warehouseId), eq(stock.productId, productId)));
      }

      // 3. Crear la venta (recibo) y sus líneas
      const [nuevaVenta] = await tx.insert(sales)
        .values({ clientId, warehouseId, userId: req.user!.userId })
        .returning();

      const lineas = items.map((item) => ({
        saleId: nuevaVenta.id,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice != null ? item.unitPrice.toString() : null,
      }));

      await tx.insert(saleItems).values(lineas);

      return { ...nuevaVenta, items: lineas };
    });

    res.status(201).json(resultado);
  } catch (error: any) {
    if (error?.message === 'Stock insuficiente para uno de los productos seleccionados') {
      res.status(400).json({ message: error.message });
      return;
    }
    console.error('Error creating sale:', error);
    res.status(500).json({ message: 'No se pudo registrar la venta' });
  }
}

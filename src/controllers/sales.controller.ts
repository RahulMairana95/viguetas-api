import { Request, Response } from 'express';
import { db } from '../db';
import { stock, sales, clients, products, warehouses, users } from '../db/schema';
import { eq, and, count, ilike, or, desc } from 'drizzle-orm';

export async function listSales(req: Request, res: Response): Promise<void> {
  try {
    const search = (req.query.search as string)?.replace(/['"]/g, '').trim() || '';
    const { warehouseId, clientId } = req.query;

    const condiciones = [];
    if (warehouseId) condiciones.push(eq(sales.warehouseId, warehouseId as string));
    if (clientId) condiciones.push(eq(sales.clientId, clientId as string));
    if (search) condiciones.push(or(
      ilike(clients.name, `%${search}%`),
      ilike(products.name, `%${search}%`)
    ));

    const whereClause = condiciones.length > 0 ? and(...condiciones) : undefined;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const [{ total }] = await db.select({ total: count() })
      .from(sales)
      .innerJoin(clients, eq(sales.clientId, clients.id))
      .innerJoin(products, eq(sales.productId, products.id))
      .where(whereClause);

    const resultado = await db.select({
      id: sales.id,
      clientId: sales.clientId,
      productId: sales.productId,
      warehouseId: sales.warehouseId,
      quantity: sales.quantity,
      unitPrice: sales.unitPrice,
      date: sales.date,
      userId: sales.userId,
      client: {
        id: clients.id,
        name: clients.name,
      },
      product: {
        id: products.id,
        name: products.name,
        productType: products.productType,
        measurement: products.measurement,
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
      .innerJoin(products, eq(sales.productId, products.id))
      .innerJoin(warehouses, eq(sales.warehouseId, warehouses.id))
      .innerJoin(users, eq(sales.userId, users.id))
      .where(whereClause)
      .orderBy(desc(sales.updatedAt))
      .limit(limit)
      .offset(offset);

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
    const { clientId, productId, warehouseId, quantity, unitPrice } = req.body;

    if (!clientId || !productId || !warehouseId || quantity === undefined || quantity === null) {
      res.status(400).json({ message: 'clientId, productId, warehouseId y quantity son requeridos' });
      return;
    }

    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
      res.status(400).json({ message: 'La cantidad debe ser un número entero mayor a cero' });
      return;
    }

    const result = await db.transaction(async (tx) => {
      // Bloquea la fila de stock para evitar condiciones de carrera con
      // ventas o traslados simultáneos sobre el mismo producto/almacén.
      const [stockActual] = await tx.select().from(stock)
        .where(and(eq(stock.warehouseId, warehouseId), eq(stock.productId, productId)))
        .for('update');

      if (!stockActual || stockActual.quantity < quantity) {
        throw new Error('Stock insuficiente en el almacén seleccionado');
      }

      await tx.update(stock)
        .set({ quantity: stockActual.quantity - quantity, updatedAt: new Date() })
        .where(and(eq(stock.warehouseId, warehouseId), eq(stock.productId, productId)));

      const [nuevaVenta] = await tx.insert(sales)
        .values({
          clientId,
          productId,
          warehouseId,
          quantity,
          unitPrice: unitPrice ?? null,
          userId: req.user!.userId,
        })
        .returning();

      return nuevaVenta;
    });

    res.status(201).json(result);
  } catch (error: any) {
    if (error?.message === 'Stock insuficiente en el almacén seleccionado') {
      res.status(400).json({ message: error.message });
      return;
    }
    console.error('Error creating sale:', error);
    res.status(500).json({ message: 'No se pudo registrar la venta' });
  }
}

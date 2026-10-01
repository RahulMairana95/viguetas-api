import { Request, Response } from 'express';
import { db } from '../db';
import { stock, transfers, warehouses, products, users } from '../db/schema';
import { eq, and, count, ilike, or, desc } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

const warehousesDest = alias(warehouses, 'warehouses_dest');

export async function listTransfers(req: Request, res: Response): Promise<void> {
  try {
    const search = (req.query.search as string)?.replace(/['"]/g, '').trim() || '';
    const { originId, destinationId, productId, warehouseId } = req.query;

    const condiciones = [];
    if (originId) condiciones.push(eq(transfers.originId, originId as string));
    if (destinationId) condiciones.push(eq(transfers.destinationId, destinationId as string));
    if (productId) condiciones.push(eq(transfers.productId, productId as string));
    if (warehouseId) condiciones.push(or(
      eq(transfers.originId, warehouseId as string),
      eq(transfers.destinationId, warehouseId as string)
    ));
    if (search) condiciones.push(ilike(products.name, `%${search}%`));

    const whereClause = condiciones.length > 0 ? and(...condiciones) : undefined;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const [{ total }] = await db.select({ total: count() })
      .from(transfers)
      .innerJoin(products, eq(transfers.productId, products.id))
      .where(whereClause);

    const resultado = await db.select({
      id: transfers.id,
      productId: transfers.productId,
      originId: transfers.originId,
      destinationId: transfers.destinationId,
      quantity: transfers.quantity,
      userId: transfers.userId,
      createdAt: transfers.createdAt,
      product: {
        id: products.id,
        name: products.name,
        productType: products.productType,
        measurement: products.measurement,
      },
      origin: {
        id: warehouses.id,
        name: warehouses.name,
      },
      destination: {
        id: warehousesDest.id,
        name: warehousesDest.name,
      },
      user: {
        id: users.id,
        name: users.name,
      },
    })
      .from(transfers)
      .innerJoin(products, eq(transfers.productId, products.id))
      .innerJoin(warehouses, eq(transfers.originId, warehouses.id))
      .innerJoin(warehousesDest, eq(transfers.destinationId, warehousesDest.id))
      .innerJoin(users, eq(transfers.userId, users.id))
      .where(whereClause)
      .orderBy(desc(transfers.updatedAt))
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
    res.status(500).json({ message: 'Error fetching transfers' });
  }
}

export async function createTransfer(req: Request, res: Response): Promise<void> {
  try {
    const { productId, originId, destinationId, quantity } = req.body;

    if (!productId || !originId || !destinationId || quantity === undefined || quantity === null) {
      res.status(400).json({ message: 'Todos los campos son requeridos' });
      return;
    }

    if (originId === destinationId) {
      res.status(400).json({ message: 'El origen y el destino no pueden ser el mismo almacén' });
      return;
    }

    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
      res.status(400).json({ message: 'La cantidad debe ser un número entero mayor a cero' });
      return;
    }

    const result = await db.transaction(async (tx) => {
      // Bloquea la fila de stock del origen para evitar condiciones de carrera
      // entre traslados simultáneos (evita stock negativo).
      const [stockOrigen] = await tx.select().from(stock)
        .where(and(eq(stock.warehouseId, originId), eq(stock.productId, productId)))
        .for('update');

      if (!stockOrigen || stockOrigen.quantity < quantity) {
        throw new Error('Stock insuficiente en el almacén de origen');
      }

      await tx.update(stock)
        .set({ quantity: stockOrigen.quantity - quantity, updatedAt: new Date() })
        .where(and(eq(stock.warehouseId, originId), eq(stock.productId, productId)));

      const [stockDestino] = await tx.select().from(stock)
        .where(and(eq(stock.warehouseId, destinationId), eq(stock.productId, productId)));

      if (stockDestino) {
        await tx.update(stock)
          .set({ quantity: stockDestino.quantity + quantity, updatedAt: new Date() })
          .where(and(eq(stock.warehouseId, destinationId), eq(stock.productId, productId)));
      } else {
        await tx.insert(stock).values({ warehouseId: destinationId, productId, quantity });
      }

      const [nuevoTraslado] = await tx.insert(transfers)
        .values({ productId, originId, destinationId, quantity, userId: req.user!.userId })
        .returning();

      return nuevoTraslado;
    });

    res.status(201).json(result);
  } catch (error: any) {
    if (error?.message === 'Stock insuficiente en el almacén de origen') {
      res.status(400).json({ message: error.message });
      return;
    }
    console.error('Error creating transfer:', error);
    res.status(500).json({ message: 'No se pudo registrar el traslado' });
  }
}

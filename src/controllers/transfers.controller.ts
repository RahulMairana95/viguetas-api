import { Request, Response } from 'express';
import { db } from '../db';
import { stock, transfers, transferItems, warehouses, products, users } from '../db/schema';
import { eq, and, count, ilike, or, desc, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

const warehousesDest = alias(warehouses, 'warehouses_dest');

export async function listTransfers(req: Request, res: Response): Promise<void> {
  try {
    const search = (req.query.search as string)?.replace(/['"]/g, '').trim() || '';
    const { originId, destinationId, productId, warehouseId } = req.query;

    const condiciones = [];
    if (originId) condiciones.push(eq(transfers.originId, originId as string));
    if (destinationId) condiciones.push(eq(transfers.destinationId, destinationId as string));
    if (warehouseId) condiciones.push(or(
      eq(transfers.originId, warehouseId as string),
      eq(transfers.destinationId, warehouseId as string)
    ));
    if (productId) {
      const sub = db.select({ transferId: transferItems.transferId })
        .from(transferItems)
        .where(eq(transferItems.productId, productId as string));
      condiciones.push(inArray(transfers.id, sub));
    }
    if (search) {
      const sub = db.select({ transferId: transferItems.transferId })
        .from(transferItems)
        .innerJoin(products, eq(transferItems.productId, products.id))
        .where(ilike(products.name, `%${search}%`));
      condiciones.push(inArray(transfers.id, sub));
    }

    const whereClause = condiciones.length > 0 ? and(...condiciones) : undefined;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const [{ total }] = await db.select({ total: count() }).from(transfers).where(whereClause);

    const resultado = await db.select({
      id: transfers.id,
      originId: transfers.originId,
      destinationId: transfers.destinationId,
      userId: transfers.userId,
      createdAt: transfers.createdAt,
      updatedAt: transfers.updatedAt,
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
      .innerJoin(warehouses, eq(transfers.originId, warehouses.id))
      .innerJoin(warehousesDest, eq(transfers.destinationId, warehousesDest.id))
      .innerJoin(users, eq(transfers.userId, users.id))
      .where(whereClause)
      .orderBy(desc(transfers.createdAt))
      .limit(limit)
      .offset(offset);

    let data: any[] = [];

    if (resultado.length > 0) {
      const items = await db.select({
        transferId: transferItems.transferId,
        productId: transferItems.productId,
        quantity: transferItems.quantity,
        product: {
          id: products.id,
          name: products.name,
          productType: products.productType,
          measurement: products.measurement,
        },
      })
        .from(transferItems)
        .innerJoin(products, eq(transferItems.productId, products.id))
        .where(inArray(transferItems.transferId, resultado.map((t) => t.id)));

      data = resultado.map((traslado) => ({
        ...traslado,
        items: items.filter((i) => i.transferId === traslado.id),
      }));
    }

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
    res.status(500).json({ message: 'Error fetching transfers' });
  }
}

type ItemTraslado = { productId: string; quantity: number };

export async function createTransfer(req: Request, res: Response): Promise<void> {
  try {
    const { destinationId, items } = req.body as {
      destinationId: string;
      items: ItemTraslado[];
    };
    let { originId } = req.body as { originId?: string };

    // Si el usuario tiene almacén asignado (cualquier rol), se fuerza ese
    // almacén como origen y se ignora lo que mande el body. Solo quien no
    // tiene almacén asignado elige libremente. El destino queda libre.
    const [usuario] = await db.select({ warehouseId: users.warehouseId })
      .from(users)
      .where(eq(users.id, req.user!.userId));

    if (usuario?.warehouseId) {
      originId = usuario.warehouseId;
    }

    if (!originId || !destinationId || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ message: 'Origen, destino y al menos un producto son requeridos' });
      return;
    }

    if (originId === destinationId) {
      res.status(400).json({ message: 'El origen y el destino no pueden ser el mismo almacén' });
      return;
    }

    for (const item of items) {
      if (!item.productId || typeof item.quantity !== 'number' ||
          !Number.isInteger(item.quantity) || item.quantity <= 0) {
        res.status(400).json({ message: 'Cada producto debe tener productId y cantidad entera mayor a cero' });
        return;
      }
    }

    // Acumula cantidades por producto (si un producto aparece en varias
    // líneas, se mueve la suma una sola vez).
    const cantidades = new Map<string, number>();
    for (const item of items) {
      cantidades.set(item.productId, (cantidades.get(item.productId) ?? 0) + item.quantity);
    }

    const resultado = await db.transaction(async (tx) => {
      // 1. Bloquear y verificar el stock de TODOS los productos en el origen
      //    antes de mover cualquiera (FOR UPDATE evita condiciones de carrera).
      const stocks = new Map<string, typeof stock.$inferSelect>();
      for (const [productId, cantidad] of cantidades) {
        const [stockOrigen] = await tx.select().from(stock)
          .where(and(eq(stock.warehouseId, originId), eq(stock.productId, productId)))
          .for('update');

        if (!stockOrigen || stockOrigen.quantity < cantidad) {
          throw new Error('Stock insuficiente para uno de los productos seleccionados');
        }
        stocks.set(productId, stockOrigen);
      }

      // 2. Restar del origen y sumar al destino, producto por producto
      for (const [productId, cantidad] of cantidades) {
        const stockOrigen = stocks.get(productId)!;
        await tx.update(stock)
          .set({ quantity: stockOrigen.quantity - cantidad, updatedAt: new Date() })
          .where(and(eq(stock.warehouseId, originId), eq(stock.productId, productId)));

        const [stockDestino] = await tx.select().from(stock)
          .where(and(eq(stock.warehouseId, destinationId), eq(stock.productId, productId)));

        if (stockDestino) {
          await tx.update(stock)
            .set({ quantity: stockDestino.quantity + cantidad, updatedAt: new Date() })
            .where(and(eq(stock.warehouseId, destinationId), eq(stock.productId, productId)));
        } else {
          await tx.insert(stock).values({ warehouseId: destinationId, productId, quantity: cantidad });
        }
      }

      // 3. Crear el traslado y sus líneas
      const [nuevoTraslado] = await tx.insert(transfers)
        .values({ originId, destinationId, userId: req.user!.userId })
        .returning();

      const lineas = items.map((item) => ({
        transferId: nuevoTraslado.id,
        productId: item.productId,
        quantity: item.quantity,
      }));

      await tx.insert(transferItems).values(lineas);

      return { ...nuevoTraslado, items: lineas };
    });

    res.status(201).json(resultado);
  } catch (error: any) {
    if (error?.message === 'Stock insuficiente para uno de los productos seleccionados') {
      res.status(400).json({ message: error.message });
      return;
    }
    console.error('Error creating transfer:', error);
    res.status(500).json({ message: 'No se pudo registrar el traslado' });
  }
}

import { Request, Response } from 'express';
import { db } from '../db';
import { stock, warehouses, products, productTypeEnum } from '../db/schema';
import { eq, and, count, ilike, or, desc } from 'drizzle-orm';

export async function listStock(req: Request, res: Response): Promise<void> {
  try {
    const search = (req.query.search as string)?.replace(/['"]/g, '').trim() || '';
    const { warehouseId, productId, productType } = req.query;

    if (productType && !productTypeEnum.enumValues.includes(productType as 'vigueta' | 'plastoformo')) {
      res.status(400).json({ message: `productType debe ser uno de: ${productTypeEnum.enumValues.join(', ')}` });
      return;
    }

    const condiciones = [];
    if (warehouseId) condiciones.push(eq(stock.warehouseId, warehouseId as string));
    if (productId) condiciones.push(eq(stock.productId, productId as string));
    if (productType) condiciones.push(eq(products.productType, productType as 'vigueta' | 'plastoformo'));
    if (search) condiciones.push(or(
      ilike(products.name, `%${search}%`),
      ilike(warehouses.name, `%${search}%`)
    ));

    const whereClause = condiciones.length > 0 ? and(...condiciones) : undefined;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const [{ total }] = await db.select({ total: count() })
      .from(stock)
      .innerJoin(warehouses, eq(stock.warehouseId, warehouses.id))
      .innerJoin(products, eq(stock.productId, products.id))
      .where(whereClause);

    const resultado = await db.select({
      warehouseId: stock.warehouseId,
      productId: stock.productId,
      quantity: stock.quantity,
      warehouse: {
        id: warehouses.id,
        name: warehouses.name,
        type: warehouses.type,
      },
      product: {
        id: products.id,
        name: products.name,
        productType: products.productType,
        measurement: products.measurement,
      },
    })
      .from(stock)
      .innerJoin(warehouses, eq(stock.warehouseId, warehouses.id))
      .innerJoin(products, eq(stock.productId, products.id))
      .where(whereClause)
      .orderBy(desc(stock.updatedAt))
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
    res.status(500).json({ message: 'Error fetching stock' });
  }
}

export async function getStockItem(req: Request, res: Response): Promise<void> {
  try {
    const warehouseId = req.params.warehouseId as string;
    const productId = req.params.productId as string;

    const [stockItem] = await db.select({
      warehouseId: stock.warehouseId,
      productId: stock.productId,
      quantity: stock.quantity,
      warehouse: {
        id: warehouses.id,
        name: warehouses.name,
        type: warehouses.type,
      },
      product: {
        id: products.id,
        name: products.name,
        productType: products.productType,
        measurement: products.measurement,
      },
    })
      .from(stock)
      .innerJoin(warehouses, eq(stock.warehouseId, warehouses.id))
      .innerJoin(products, eq(stock.productId, products.id))
      .where(and(
        eq(stock.warehouseId, warehouseId),
        eq(stock.productId, productId)
      ));

    if (!stockItem) {
      res.status(404).json({ message: 'Stock not found' });
      return;
    }

    res.json(stockItem);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching stock' });
  }
}

export async function upsertStock(req: Request, res: Response): Promise<void> {
  try {
    const { warehouseId, productId, quantity } = req.body;

    if (!warehouseId || !productId || quantity === undefined) {
      res.status(400).json({ message: 'warehouseId, productId y quantity son requeridos' });
      return;
    }

    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 0) {
      res.status(400).json({ message: 'La cantidad debe ser un número entero no negativo' });
      return;
    }

    const [existente] = await db.select().from(stock)
      .where(and(eq(stock.warehouseId, warehouseId), eq(stock.productId, productId)));

    if (existente) {
      await db.update(stock)
        .set({ quantity, updatedAt: new Date() })
        .where(and(eq(stock.warehouseId, warehouseId), eq(stock.productId, productId)));
    } else {
      await db.insert(stock).values({ warehouseId, productId, quantity });
    }

    res.status(200).json({ warehouseId, productId, quantity });
  } catch (error) {
    res.status(500).json({ message: 'Error updating stock' });
  }
}

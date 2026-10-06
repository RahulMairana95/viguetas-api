import { Request, Response } from 'express';
import { db } from '../db';
import { orders, orderItems, stock, products } from '../db/schema';
import { eq, sum } from 'drizzle-orm';

export async function getPlanningReport(req: Request, res: Response): Promise<void> {
  try {
    const listaProductos = await db.select().from(products);

    const demandaPorProducto = await db
      .select({ productId: orderItems.productId, total: sum(orderItems.quantity) })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(eq(orders.status, 'pending'))
      .groupBy(orderItems.productId);

    const stockPorProducto = await db
      .select({ productId: stock.productId, total: sum(stock.quantity) })
      .from(stock)
      .groupBy(stock.productId);

    const mapaDemanda = Object.fromEntries(
      demandaPorProducto.map((d) => [d.productId, Number(d.total) || 0])
    );
    const mapaStock = Object.fromEntries(
      stockPorProducto.map((s) => [s.productId, Number(s.total) || 0])
    );

    const resultado = listaProductos.map((p) => {
      const demandado = mapaDemanda[p.id] || 0;
      const disponible = mapaStock[p.id] || 0;
      const falta = Math.max(0, demandado - disponible);
      return { productId: p.id, productName: p.name, demandado, disponible, falta };
    });

    // Solo productos con demanda o stock (los demás no aportan al reporte)
    res.json({ data: resultado.filter((r) => r.demandado > 0 || r.disponible > 0) });
  } catch (error) {
    console.error('Error fetching planning report:', error);
    res.status(500).json({ message: 'Error fetching planning report' });
  }
}

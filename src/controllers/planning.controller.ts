import { Request, Response } from 'express';
import { db } from '../db';
import { orders, orderItems, stock, products, users, warehouses } from '../db/schema';
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

    // Disponible: SOLO el almacén del usuario autenticado (donde se surten los pedidos).
    // Las tiendas quedan fuera del cálculo porque su material está en otros lugares
    // para recolección local. Si el usuario no tiene almacén asignado (p. ej. un
    // superadmin), se toman los almacenes de tipo fábrica.
    const [usuario] = await db
      .select({ warehouseId: users.warehouseId })
      .from(users)
      .where(eq(users.id, req.user!.userId));

    const stockPorProducto = usuario?.warehouseId
      ? await db
          .select({ productId: stock.productId, total: sum(stock.quantity) })
          .from(stock)
          .where(eq(stock.warehouseId, usuario.warehouseId))
          .groupBy(stock.productId)
      : await db
          .select({ productId: stock.productId, total: sum(stock.quantity) })
          .from(stock)
          .innerJoin(warehouses, eq(stock.warehouseId, warehouses.id))
          .where(eq(warehouses.type, 'factory'))
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

import { Request, Response } from 'express';
import { eq, sum } from 'drizzle-orm';
import { db } from '../db';
import { products, sales, saleItems, stock, warehouses, productions } from '../db/schema';

// Reporte de planificación.
//
// Fórmula: falta = programado − enFabrica − enProduccion
// - "programado": líneas de ventas programadas, sin importar su origen.
// - "enFabrica": SOLO el stock del almacén de tipo fábrica (las tiendas no
//   cuentan: su material está en otros lugares para recolección local).
// - "enProduccion": producción ya registrada y todavía pendiente.
export async function getPlanningReport(_req: Request, res: Response): Promise<void> {
  try {
    const listaProductos = await db.select().from(products);

    // Programado: líneas de ventas programadas
    const programado = await db
      .select({ productId: saleItems.productId, total: sum(saleItems.quantity) })
      .from(saleItems)
      .innerJoin(sales, eq(saleItems.saleId, sales.id))
      .where(eq(sales.status, 'scheduled'))
      .groupBy(saleItems.productId);

    // Solo el stock del almacén de tipo fábrica
    const enFabrica = await db
      .select({ productId: stock.productId, total: sum(stock.quantity) })
      .from(stock)
      .innerJoin(warehouses, eq(stock.warehouseId, warehouses.id))
      .where(eq(warehouses.type, 'factory'))
      .groupBy(stock.productId);

    // Producción ya registrada y todavía pendiente
    const enProduccion = await db
      .select({ productId: productions.productId, total: sum(productions.quantity) })
      .from(productions)
      .where(eq(productions.status, 'pending'))
      .groupBy(productions.productId);

    const aMapa = (filas: { productId: string; total: string | null }[]) =>
      Object.fromEntries(filas.map((f) => [f.productId, Number(f.total) || 0]));
    const mProg = aMapa(programado), mFab = aMapa(enFabrica), mProd = aMapa(enProduccion);

    const resultado = listaProductos.map((p) => {
      const prog = mProg[p.id] || 0, fab = mFab[p.id] || 0;
      // Las viguetas se fabrican: la producción pendiente cuenta para bajar el
      // faltante. Los plastoformos se compran: solo cuenta el stock real.
      const prod = p.productType === 'vigueta' ? (mProd[p.id] || 0) : 0;
      return {
        productId: p.id,
        productName: p.name,
        productType: p.productType,
        serie: p.serie,
        longitud: p.longitud,
        grosor: p.grosor,
        ancho: p.ancho,
        largo: p.largo,
        programado: prog,
        enFabrica: fab,
        enProduccion: prod,
        falta: Math.max(0, prog - fab - prod),
      };
    });

    // Se muestran: (a) productos con falta real, y (b) productos con pedido
    // programado ya cubierto (Falta 0) para poder verificar que la demanda
    // quedó registrada. Se ocultan: solo-stock o producción sin pedido.
    res.json({
      data: resultado.filter((r) => r.falta > 0 || r.programado > 0),
    });
  } catch (error) {
    console.error('Error fetching planning report:', error);
    res.status(500).json({ message: 'Error fetching planning report' });
  }
}

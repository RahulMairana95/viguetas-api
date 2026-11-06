import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { stock, warehouses, products } from '../db/schema';
import { HttpError } from './errors';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type Linea = { productId: string; warehouseId: string; quantity: number };

// Descuento de stock dentro de una transacción, usado por las ventas.
//
// Dos detalles importantes:
// 1) Se ACUMULA por (almacén, producto) antes de verificar: sin eso, dos líneas
//    del mismo producto y almacén (20 + 20 con 30 disponibles) pasarían la
//    verificación una por una y dejarían el stock en negativo.
// 2) Se bloquean las filas en orden fijo (FOR UPDATE + sort) para evitar
//    bloqueos cruzados entre transacciones concurrentes.
export async function descontarStock(tx: Tx, lineas: Linea[]) {
  // 1) Sumar por (almacén, producto)
  const acumulado = new Map<string, Linea>();
  for (const l of lineas) {
    const key = `${l.warehouseId}:${l.productId}`;
    const previo = acumulado.get(key);
    acumulado.set(key, { ...l, quantity: (previo?.quantity ?? 0) + l.quantity });
  }

  // 2) Verificar TODO antes de descontar
  const entradas = [...acumulado.entries()].sort(([a], [b]) => a.localeCompare(b));
  const disponibles = new Map<string, number>();
  const faltantes: (Linea & { disponible: number })[] = [];

  for (const [key, l] of entradas) {
    const [fila] = await tx.select().from(stock)
      .where(and(eq(stock.warehouseId, l.warehouseId), eq(stock.productId, l.productId)))
      .for('update');
    const disponible = fila?.quantity ?? 0;
    disponibles.set(key, disponible);
    if (disponible < l.quantity) faltantes.push({ ...l, disponible });
  }

  if (faltantes.length > 0) {
    const almacenes = await tx.select({ id: warehouses.id, name: warehouses.name }).from(warehouses)
      .where(inArray(warehouses.id, faltantes.map((f) => f.warehouseId)));
    const prods = await tx.select({ id: products.id, name: products.name }).from(products)
      .where(inArray(products.id, faltantes.map((f) => f.productId)));

    // El detalle permite que el frontend marque exactamente qué línea corregir.
    throw new HttpError(409, 'Stock insuficiente', {
      shortages: faltantes.map((f) => ({
        warehouseId: f.warehouseId,
        warehouseName: almacenes.find((a) => a.id === f.warehouseId)?.name,
        productId: f.productId,
        productName: prods.find((p) => p.id === f.productId)?.name,
        available: f.disponible,
        needed: f.quantity,
      })),
    });
  }

  // 3) Descontar
  for (const [key, l] of entradas) {
    await tx.update(stock)
      .set({ quantity: disponibles.get(key)! - l.quantity, updatedAt: new Date() })
      .where(and(eq(stock.warehouseId, l.warehouseId), eq(stock.productId, l.productId)));
  }
}

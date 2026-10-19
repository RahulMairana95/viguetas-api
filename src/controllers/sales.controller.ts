import { Request, Response } from 'express';
import { and, desc, eq, inArray, count } from 'drizzle-orm';
import { db } from '../db';
import { sales, saleItems, clients, products, warehouses, users } from '../db/schema';
import { descontarStock, Linea } from '../lib/stockOut';
import { resolveWarehouse } from '../lib/resolveWarehouse';
import { HttpError, responderError } from '../lib/errors';

type ItemVenta = {
  productId: string;
  quantity: number;
  unitPrice?: number | null;
  warehouseId?: string;
  longitud?: string | null;
};

// Normaliza las líneas del body. Para promoter el origen SIEMPRE es su tienda,
// sin importar lo que mande el frontend; para admin puede elegir por línea
// (por defecto, su propio almacén si tiene uno asignado).
function normalizarLineas(items: unknown, origenPropio: string | null, esAdmin: boolean): (Linea & { unitPrice: string | null })[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'Agrega al menos un producto');
  }

  return (items as ItemVenta[]).map((i) => {
    if (!i.productId || !Number.isInteger(i.quantity) || i.quantity <= 0) {
      throw new HttpError(400, 'Cada línea debe tener producto y una cantidad entera mayor a cero');
    }
    if (i.unitPrice !== undefined && i.unitPrice !== null &&
        (typeof i.unitPrice !== 'number' || i.unitPrice < 0)) {
      throw new HttpError(400, 'unitPrice debe ser un número mayor o igual a cero');
    }
    const warehouseId = esAdmin ? (i.warehouseId ?? origenPropio) : origenPropio;
    if (!warehouseId) {
      throw new HttpError(400, 'Cada línea debe indicar el almacén de origen y tu usuario no tiene un almacén asignado');
    }
    return {
      productId: i.productId,
      quantity: i.quantity,
      unitPrice: i.unitPrice == null || (i.unitPrice as unknown) === '' ? null : String(i.unitPrice),
      warehouseId,
      longitud: i.longitud?.trim() ? i.longitud.trim() : null,
    };
  });
}

// Normaliza el pago: el saldo nunca se recibe, se deriva como total − adelanto.
function normalizarAdelanto(adelanto: unknown): string {
  if (adelanto === undefined || adelanto === null || adelanto === '') return '0';
  const n = Number(adelanto);
  if (Number.isNaN(n) || n < 0) throw new HttpError(400, 'El adelanto debe ser un número mayor o igual a cero');
  return n.toFixed(2);
}

// Fecha de registro `YYYY-MM-DD`; si no llega, se usa la de hoy.
function normalizarFechaRegistro(fecha: unknown): string {
  if (fecha === undefined || fecha === null || fecha === '') {
    return new Date().toISOString().slice(0, 10);
  }
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new HttpError(400, 'registeredDate debe tener formato YYYY-MM-DD');
  }
  return fecha;
}

// GET /api/sales?status=&clientId=&page=&limit=
export async function listSales(req: Request, res: Response): Promise<void> {
  try {
    const { status, clientId } = req.query;

    const condiciones = [];
    if (status && status !== 'all') {
      if (!['scheduled', 'completed', 'cancelled'].includes(status as string)) {
        res.status(400).json({ message: 'Status must be scheduled, completed, cancelled or all' });
        return;
      }
      condiciones.push(eq(sales.status, status as 'scheduled' | 'completed' | 'cancelled'));
    }
    if (clientId) condiciones.push(eq(sales.clientId, clientId as string));

    // promoter: solo ventas con al menos una línea que salga de su almacén
    if (req.userRol === 'promoter') {
      if (!req.userAlmacenId) {
        res.json({ data: [], pagination: { page: 1, limit: 0, total: 0, totalPages: 0 } });
        return;
      }
      condiciones.push(inArray(
        sales.id,
        db.select({ id: saleItems.saleId }).from(saleItems).where(eq(saleItems.warehouseId, req.userAlmacenId))
      ));
    }

    const whereClause = condiciones.length > 0 ? and(...condiciones) : undefined;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const [{ total }] = await db.select({ total: count() }).from(sales).where(whereClause);

    const ventas = await db.select({
      id: sales.id,
      clientId: sales.clientId,
      status: sales.status,
      deliveryDate: sales.deliveryDate,
      deliveryPlace: sales.deliveryPlace,
      deliveredAt: sales.deliveredAt,
      esProgramada: sales.esProgramada,
      adelanto: sales.adelanto,
      registeredDate: sales.registeredDate,
      date: sales.date,
      client: { id: clients.id, name: clients.name, phone: clients.phone },
      user: { id: users.id, name: users.name },
    })
      .from(sales)
      .innerJoin(clients, eq(sales.clientId, clients.id))
      .innerJoin(users, eq(sales.userId, users.id))
      .where(whereClause)
      .orderBy(desc(sales.date))
      .limit(limit)
      .offset(offset);

    const resultado = await hidratarItems(ventas);

    res.json({
      data: resultado,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (e) {
    responderError(res, e);
  }
}

// Adjunta las líneas de cada venta (con su almacén de origen) y el total.
async function hidratarItems<T extends { id: string }>(ventas: T[]) {
  if (ventas.length === 0) return [];

  const items = await db.select({
    saleId: saleItems.saleId,
    productId: saleItems.productId,
    productName: products.name,
    longitudProducto: products.longitud,
    grosor: products.grosor,
    ancho: products.ancho,
    largo: products.largo,
    warehouseId: saleItems.warehouseId,
    warehouseName: warehouses.name,
    warehouseType: warehouses.type,
    warehousePhone: warehouses.phone,
    warehouseAddress: warehouses.address,
    quantity: saleItems.quantity,
    unitPrice: saleItems.unitPrice,
    longitud: saleItems.longitud,
  })
    .from(saleItems)
    .innerJoin(products, eq(saleItems.productId, products.id))
    .innerJoin(warehouses, eq(saleItems.warehouseId, warehouses.id))
    .where(inArray(saleItems.saleId, ventas.map((v) => v.id)));

  return ventas.map((venta) => {
    const lineas = items.filter((i) => i.saleId === venta.id);
    return {
      ...venta,
      items: lineas,
      total: lineas.reduce((acc, i) => acc + (Number(i.unitPrice) || 0) * i.quantity, 0),
    };
  });
}

// POST /api/sales
//
// Venta inmediata (por defecto): nace completed y descuenta stock.
// Venta programada (programada=true): nace scheduled, NO toca stock.
// Solo el admin puede programar.
export async function createSale(req: Request, res: Response): Promise<void> {
  try {
    const { clientId, items, programada, deliveryDate, deliveryPlace, adelanto, registeredDate } =
      req.body;
    const esAdmin = req.userRol === 'admin';

    if (!clientId) throw new HttpError(400, 'El cliente es requerido');
    if (programada && !esAdmin) throw new HttpError(403, 'Solo un admin puede programar ventas');

    const { warehouseId: origenPropio } = resolveWarehouse(req);

    const lineas = normalizarLineas(items, origenPropio, esAdmin);

    if (programada) {
      if (!deliveryDate) throw new HttpError(400, 'La fecha de entrega es requerida');
      if (!deliveryPlace?.trim()) throw new HttpError(400, 'El lugar de entrega es requerido');
    }

    const venta = await db.transaction(async (tx) => {
      if (!programada) await descontarStock(tx, lineas); // la programada NO toca el stock

      const [nueva] = await tx.insert(sales).values({
        clientId,
        userId: req.userId,
        status: programada ? 'scheduled' : 'completed',
        deliveryDate: programada ? deliveryDate : null,
        deliveryPlace: programada ? deliveryPlace.trim() : null,
        deliveredAt: programada ? null : new Date(),
        esProgramada: Boolean(programada),
        adelanto: normalizarAdelanto(adelanto),
        registeredDate: normalizarFechaRegistro(registeredDate),
      }).returning();

      await tx.insert(saleItems).values(lineas.map((l) => ({ ...l, saleId: nueva.id })));
      return nueva;
    });

    res.status(201).json(venta);
  } catch (e) {
    responderError(res, e);
  }
}

// PATCH /api/sales/:id — solo ventas programadas.
// Si llegan items, reemplazan todas las líneas.
export async function updateSale(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const { clientId, deliveryDate, deliveryPlace, adelanto, registeredDate, items } = req.body;

    const { warehouseId: origenPropio } = resolveWarehouse(req);

    await db.transaction(async (tx) => {
      const [v] = await tx.select().from(sales).where(eq(sales.id, id)).for('update');
      if (!v) throw new HttpError(404, 'Venta no encontrada');
      if (v.status !== 'scheduled') throw new HttpError(409, 'Solo se pueden editar ventas programadas');

      await tx.update(sales).set({
        clientId: clientId ?? v.clientId,
        deliveryDate: deliveryDate ?? v.deliveryDate,
        deliveryPlace: deliveryPlace?.trim() || v.deliveryPlace,
        // undefined = no se toca; null/'' vuelve a cero
        adelanto: adelanto === undefined ? v.adelanto : normalizarAdelanto(adelanto),
        registeredDate: registeredDate === undefined ? v.registeredDate : normalizarFechaRegistro(registeredDate),
        updatedAt: new Date(),
      }).where(eq(sales.id, id));

      if (items) {
        const lineas = normalizarLineas(items, origenPropio, true);
        await tx.delete(saleItems).where(eq(saleItems.saleId, id));
        await tx.insert(saleItems).values(lineas.map((l) => ({ ...l, saleId: id })));
      }
    });

    res.json({ ok: true });
  } catch (e) {
    responderError(res, e);
  }
}

// POST /api/sales/:id/deliver
//
// Entrega: valida y descuenta el stock de cada línea según su origen.
// Si falla por stock, la transacción se revierte completa (incluidos los
// cambios de líneas) y no se guarda nada.
export async function deliverSale(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const { items } = req.body; // opcional: líneas finales, con el origen ajustado el día de la entrega

    const { warehouseId: origenPropio } = resolveWarehouse(req);

    const venta = await db.transaction(async (tx) => {
      const [v] = await tx.select().from(sales).where(eq(sales.id, id)).for('update');
      if (!v) throw new HttpError(404, 'Venta no encontrada');
      if (v.status !== 'scheduled') throw new HttpError(409, 'Esta venta ya no está programada');

      if (items?.length) {
        const nuevas = normalizarLineas(items, origenPropio, true);
        await tx.delete(saleItems).where(eq(saleItems.saleId, id));
        await tx.insert(saleItems).values(nuevas.map((l) => ({ ...l, saleId: id })));
      }

      const lineas = await tx.select().from(saleItems).where(eq(saleItems.saleId, id));
      if (lineas.length === 0) throw new HttpError(400, 'La venta no tiene productos');

      await descontarStock(tx, lineas);

      const [entregada] = await tx.update(sales)
        .set({ status: 'completed', deliveredAt: new Date(), updatedAt: new Date() })
        .where(eq(sales.id, id)).returning();
      return entregada;
    });

    res.json(venta);
  } catch (e) {
    responderError(res, e);
  }
}

// POST /api/sales/:id/cancel — no toca el stock porque nunca se descontó
export async function cancelSale(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;

    const [v] = await db.select().from(sales).where(eq(sales.id, id));
    if (!v) throw new HttpError(404, 'Venta no encontrada');
    if (v.status !== 'scheduled') throw new HttpError(409, 'Solo se pueden cancelar ventas programadas');

    await db.update(sales).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(sales.id, id));
    res.json({ ok: true });
  } catch (e) {
    responderError(res, e);
  }
}

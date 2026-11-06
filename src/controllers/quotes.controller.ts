import { Request, Response } from 'express';
import { and, desc, eq, count, inArray } from 'drizzle-orm';
import { db } from '../db';
import {
  quotes,
  quoteItems,
  clients,
  products,
  users,
  warehouses,
  sales,
  saleItems,
} from '../db/schema';
import { HttpError, responderError } from '../lib/errors';

// Línea que envía el frontend: producto + cantidad + precio + longitud.
// NO lleva almacén: en la cotización aún no se sabe de dónde se surte.
type ItemCotizacion = {
  productId: string;
  quantity: number;
  unitPrice?: number | null;
  longitud?: string | null;
};

// Línea lista para insertar: trae el SNAPSHOT del producto copiado a texto.
type LineaNormalizada = {
  productId: string;
  productName: string;
  productType: string | null;
  serie: string | null;
  longitudProducto: string | null;
  grosor: number | null;
  ancho: number | null;
  largo: number | null;
  quantity: number;
  unitPrice: string | null;
  longitud: string | null;
};

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

/**
 * Valida las líneas y les copia los datos del producto (nombre, tipo, serie y
 * medidas). La cotización queda así AUTÓNOMA: si mañana se borra o se edita el
 * producto, lo que se presupuestó ese día no cambia.
 * Si algún producto ya no existe, se responde 400: no hay nada que copiar.
 */
async function normalizarLineas(items: unknown): Promise<LineaNormalizada[]> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'Agrega al menos un producto');
  }

  const crudas = items as ItemCotizacion[];
  for (const i of crudas) {
    if (!i.productId || !Number.isInteger(i.quantity) || i.quantity <= 0) {
      throw new HttpError(400, 'Cada línea debe tener producto y una cantidad entera mayor a cero');
    }
    if (
      i.unitPrice !== undefined &&
      i.unitPrice !== null &&
      (typeof i.unitPrice !== 'number' || i.unitPrice < 0)
    ) {
      throw new HttpError(400, 'unitPrice debe ser un número mayor o igual a cero');
    }
  }

  const ids = [...new Set(crudas.map((i) => i.productId))];
  const catalogo = await db
    .select({
      id: products.id,
      name: products.name,
      productType: products.productType,
      serie: products.serie,
      longitud: products.longitud,
      grosor: products.grosor,
      ancho: products.ancho,
      largo: products.largo,
    })
    .from(products)
    .where(inArray(products.id, ids));

  const faltantes = ids.filter((id) => !catalogo.some((p) => p.id === id));
  if (faltantes.length > 0) {
    throw new HttpError(400, 'Uno o más productos ya no existen en el catálogo');
  }

  return crudas.map((i) => {
    const p = catalogo.find((c) => c.id === i.productId)!;
    return {
      productId: i.productId,
      productName: p.name,
      productType: p.productType ?? null,
      serie: p.serie ?? null,
      longitudProducto: p.longitud === null ? null : String(p.longitud),
      grosor: p.grosor ?? null,
      ancho: p.ancho ?? null,
      largo: p.largo ?? null,
      quantity: i.quantity,
      unitPrice:
        i.unitPrice == null || (i.unitPrice as unknown) === '' ? null : String(i.unitPrice),
      longitud: i.longitud?.trim() ? i.longitud.trim() : null,
    };
  });
}

/** Total de las líneas: sum(cantidad × unitPrice). */
const totalDe = (lineas: LineaNormalizada[]): string =>
  lineas
    .reduce((acc, l) => acc + (Number(l.unitPrice) || 0) * l.quantity, 0)
    .toFixed(2);

/**
 * Nombre del usuario que cotiza, copiado a texto (solo lectura de `users`;
 * la cotización no guarda ninguna relación con él).
 */
async function nombreDeUsuario(userId: string): Promise<string> {
  const [u] = await db
    .select({ name: users.name, lastName: users.lastName })
    .from(users)
    .where(eq(users.id, userId));
  if (!u) return '';
  return [u.name, u.lastName].filter(Boolean).join(' ').trim();
}

// GET /api/quotes?status=&clientId=&page=&limit=
export async function listQuotes(req: Request, res: Response): Promise<void> {
  try {
    const { status, clientName } = req.query;
    const condiciones = [];

    if (status && status !== 'all') {
      if (!['open', 'converted', 'cancelled'].includes(status as string)) {
        res.status(400).json({ message: 'Status must be open, converted, cancelled or all' });
        return;
      }
      condiciones.push(eq(quotes.status, status as 'open' | 'converted' | 'cancelled'));
    }
    // La cotización no guarda relación con `clients`: el cliente es texto, así
    // que el filtro es por nombre (coincidencia exacta).
    const search = (clientName as string | undefined)?.trim();
    if (search) condiciones.push(eq(quotes.clientName, search));

    const whereClause = condiciones.length > 0 ? and(...condiciones) : undefined;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const [{ total }] = await db.select({ total: count() }).from(quotes).where(whereClause);

    // Sin joins: cliente, teléfono y usuario ya vienen guardados como texto.
    const cotizaciones = await db
      .select()
      .from(quotes)
      .where(whereClause)
      .orderBy(desc(quotes.createdAt))
      .limit(limit)
      .offset(offset);

    const resultado = await hidratarItems(cotizaciones);

    res.json({
      data: resultado,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (e) {
    responderError(res, e);
  }
}

// Adjunta las líneas de cada cotización y devuelve el total guardado.
async function hidratarItems<T extends { id: string; total: string }>(cotizaciones: T[]) {
  if (cotizaciones.length === 0) return [];

  const items = await db
    .select()
    .from(quoteItems)
    .where(inArray(quoteItems.quoteId, cotizaciones.map((c) => c.id)));

  return cotizaciones.map((cot) => ({
    ...cot,
    items: items.filter((i) => i.quoteId === cot.id),
    total: Number(cot.total),
  }));
}

// POST /api/quotes — crea una cotización abierta. El número lo asigna la BD.
export async function createQuote(req: Request, res: Response): Promise<void> {
  try {
    const { clientName, clientPhone, items, notes } = req.body;

    const nombre = typeof clientName === 'string' ? clientName.trim() : '';
    if (!nombre) throw new HttpError(400, 'El cliente es requerido');
    if (nombre.length > 255) throw new HttpError(400, 'El nombre del cliente es demasiado largo');

    const lineas = await normalizarLineas(items);
    const userName = await nombreDeUsuario(req.userId);

    const cotizacion = await db.transaction(async (tx) => {
      const [nueva] = await tx
        .insert(quotes)
        .values({
          clientName: nombre,
          clientPhone: normalizarTelefono(clientPhone),
          userName,
          total: totalDe(lineas),
          notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
        })
        .returning();

      await tx.insert(quoteItems).values(lineas.map((l) => ({ ...l, quoteId: nueva.id })));
      return nueva;
    });

    res.status(201).json(cotizacion);
  } catch (e) {
    responderError(res, e);
  }
}

// Teléfono en texto libre; '' o null → null.
function normalizarTelefono(tel: unknown): string | null {
  if (tel === undefined || tel === null) return null;
  const t = String(tel).trim();
  if (!t) return null;
  if (t.length > 50) throw new HttpError(400, 'El teléfono es demasiado largo');
  return t;
}

// PATCH /api/quotes/:id — edita solo mientras siga abierta.
export async function updateQuote(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const { clientName, clientPhone, items, notes } = req.body;

    let lineas: LineaNormalizada[] | null = null;
    if (items !== undefined) lineas = await normalizarLineas(items);

    const nombre =
      clientName === undefined
        ? undefined
        : typeof clientName === 'string' && clientName.trim()
          ? clientName.trim()
          : null;
    if (nombre === null) throw new HttpError(400, 'El cliente es requerido');

    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(quotes).where(eq(quotes.id, id)).for('update');
      if (!c) throw new HttpError(404, 'Cotización no encontrada');
      if (c.status !== 'open') {
        throw new HttpError(409, 'Solo se pueden editar cotizaciones abiertas');
      }

      await tx
        .update(quotes)
        .set({
          ...(nombre !== undefined ? { clientName: nombre } : {}),
          ...(clientPhone !== undefined
            ? { clientPhone: normalizarTelefono(clientPhone) }
            : {}),
          ...(notes !== undefined
            ? { notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null }
            : {}),
          // El total se recalcula solo si llegan líneas nuevas.
          ...(lineas ? { total: totalDe(lineas) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(quotes.id, id));

      if (lineas) {
        await tx.delete(quoteItems).where(eq(quoteItems.quoteId, id));
        await tx.insert(quoteItems).values(lineas.map((l) => ({ ...l, quoteId: id })));
      }
    });

    res.json({ ok: true });
  } catch (e) {
    responderError(res, e);
  }
}

// DELETE /api/quotes/:id — borra solo mientras siga abierta.
export async function deleteQuote(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;

    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(quotes).where(eq(quotes.id, id)).for('update');
      if (!c) throw new HttpError(404, 'Cotización no encontrada');
      if (c.status !== 'open') {
        throw new HttpError(409, 'Solo se pueden borrar cotizaciones abiertas');
      }
      await tx.delete(quoteItems).where(eq(quoteItems.quoteId, id));
      await tx.delete(quotes).where(eq(quotes.id, id));
    });

    res.json({ ok: true });
  } catch (e) {
    responderError(res, e);
  }
}

/**
 * POST /api/quotes/:id/convert — aceptada por el cliente: se convierte en
 * PEDIDO (venta programada) y queda guardado el id de esa venta.
 *
 * Es el ÚNICO punto donde la cotización toca el resto del sistema (el pedido
 * sí vive de clientes, productos y almacén). Por eso aquí se resuelve el
 * cliente por nombre: si no existe en `clients`, se crea con el teléfono de la
 * cotización. Las líneas conservan el producto elegido; si ese producto se
 * borró, se avisa para que se corrija la cotización.
 */
export async function convertQuote(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const { deliveryDate, deliveryPlace, adelanto, registeredDate } = req.body;

    if (!deliveryDate) throw new HttpError(400, 'La fecha de entrega es requerida');
    if (!deliveryPlace?.trim()) throw new HttpError(400, 'El lugar de entrega es requerido');

    // Origen de fábrica para las líneas del pedido resultante.
    const [propia] = req.userAlmacenId
      ? await db
          .select({ id: warehouses.id, type: warehouses.type })
          .from(warehouses)
          .where(eq(warehouses.id, req.userAlmacenId))
      : [];
    const origenFabrica =
      propia && propia.type === 'factory'
        ? propia.id
        : (
            await db
              .select({ id: warehouses.id })
              .from(warehouses)
              .where(eq(warehouses.type, 'factory'))
              .orderBy(warehouses.name)
              .limit(1)
          )[0]?.id;

    if (!origenFabrica) {
      throw new HttpError(400, 'No existe ningún almacén de fábrica para surtir el pedido');
    }

    const venta = await db.transaction(async (tx) => {
      const [c] = await tx.select().from(quotes).where(eq(quotes.id, id)).for('update');
      if (!c) throw new HttpError(404, 'Cotización no encontrada');
      if (c.status !== 'open') {
        throw new HttpError(409, 'Esta cotización ya fue convertida o cancelada');
      }

      const lineas = await tx
        .select()
        .from(quoteItems)
        .where(eq(quoteItems.quoteId, id));
      if (lineas.length === 0) throw new HttpError(400, 'La cotización no tiene productos');

      // El producto debe seguir existiendo: la venta guarda su FK real.
      const ids = [...new Set(lineas.map((l) => l.productId))];
      const existentes = await tx
        .select({ id: products.id })
        .from(products)
        .where(inArray(products.id, ids));
      if (existentes.length !== ids.length) {
        const borrados = lineas
          .filter((l) => !existentes.some((p) => p.id === l.productId))
          .map((l) => l.productName);
        throw new HttpError(
          400,
          `El producto "${[...new Set(borrados)].join(', ')}" ya no existe en el catálogo. ` +
            'Agrégalo de nuevo o ajusta la cotización antes de convertirla.'
        );
      }

      // Cliente del pedido: se resuelve por nombre (la cotización no guarda FK).
      const nombreCliente = c.clientName.trim();
      const [existente] = await tx
        .select({ id: clients.id, phone: clients.phone })
        .from(clients)
        .where(eq(clients.name, nombreCliente))
        .limit(1);
      let clientId: string;
      if (existente) {
        clientId = existente.id;
        // Completa el teléfono si el cliente registrado no tiene.
        if (!existente.phone && c.clientPhone) {
          await tx.update(clients).set({ phone: c.clientPhone }).where(eq(clients.id, clientId));
        }
      } else {
        const [nuevo] = await tx
          .insert(clients)
          .values({ name: nombreCliente, phone: c.clientPhone })
          .returning({ id: clients.id });
        clientId = nuevo.id;
      }

      const [nueva] = await tx
        .insert(sales)
        .values({
          clientId,
          userId: req.userId,
          status: 'scheduled',
          deliveryDate,
          deliveryPlace: deliveryPlace.trim(),
          esProgramada: true,
          adelanto: normalizarAdelanto(adelanto),
          registeredDate: normalizarFechaRegistro(registeredDate),
        })
        .returning();

      await tx.insert(saleItems).values(
        lineas.map((l) => ({
          saleId: nueva.id,
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          longitud: l.longitud,
          warehouseId: origenFabrica,
        }))
      );

      await tx
        .update(quotes)
        .set({ status: 'converted', saleId: nueva.id, updatedAt: new Date() })
        .where(eq(quotes.id, id));

      return nueva;
    });

    res.status(201).json(venta);
  } catch (e) {
    responderError(res, e);
  }
}

// POST /api/quotes/:id/cancel — la cotización no siguió adelante.
export async function cancelQuote(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;

    const [c] = await db.select().from(quotes).where(eq(quotes.id, id));
    if (!c) throw new HttpError(404, 'Cotización no encontrada');
    if (c.status !== 'open') {
      throw new HttpError(409, 'Solo se pueden cancelar cotizaciones abiertas');
    }

    await db
      .update(quotes)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(quotes.id, id));

    res.json({ ok: true });
  } catch (e) {
    responderError(res, e);
  }
}

// Normaliza el pago: el saldo nunca se recibe, se deriva como total − adelanto.
function normalizarAdelanto(adelanto: unknown): string {
  if (adelanto === undefined || adelanto === null || adelanto === '') return '0';
  const n = Number(adelanto);
  if (Number.isNaN(n) || n < 0)
    throw new HttpError(400, 'El adelanto debe ser un número mayor o igual a cero');
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

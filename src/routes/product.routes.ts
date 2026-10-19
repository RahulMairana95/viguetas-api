import { Router, Request, Response } from 'express';
import { eq, count, ilike, desc, and, ne } from 'drizzle-orm';
import { db } from '../db';
import { products } from '../db/schema';
import { requireAuth, requireRole } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

router.use(requireAuth);

type ProductBody = {
  name?: string;
  productType?: string;
  price?: number | string;
  description?: string | null;
  longitud?: number | string | null;
  grosor?: number | string | null;
  ancho?: number | string | null;
  largo?: number | string | null;
};

type MedidasValidas = {
  longitud: number | null;
  grosor: number | null;
  ancho: number | null;
  largo: number | null;
};

/**
 * Valida y normaliza las medidas según el tipo de producto.
 * - vigueta: longitud en metros, requerida, 1.0–12.0, un solo decimal (múltiplos de 0.1 = 10 cm).
 * - plastoformo: grosor/ancho/largo en cm, requeridos, enteros 1–500.
 */
function validarMedidas(
  productType: string,
  body: ProductBody
): { ok: true; value: MedidasValidas } | { ok: false; error: string } {
  if (productType === 'vigueta') {
    const longitud = Number(body.longitud);
    if (body.longitud === undefined || body.longitud === null || body.longitud === '' || Number.isNaN(longitud)) {
      return { ok: false, error: 'La longitud (m) es requerida para viguetas' };
    }
    if (longitud < 1 || longitud > 12) {
      return { ok: false, error: 'La longitud de la vigueta debe estar entre 1.0 y 12.0 m' };
    }
    // Un solo decimal: múltiplos de 0.1 (ej. 3.8 = 3 m 80 cm; no 3.85).
    if (Math.abs(longitud * 10 - Math.round(longitud * 10)) > 1e-9) {
      return { ok: false, error: 'La longitud debe tener un solo decimal, en múltiplos de 0.1 m (10 cm). Ej. 3.8 = 3 m 80 cm' };
    }
    return { ok: true, value: { longitud: Math.round(longitud * 10) / 10, grosor: null, ancho: null, largo: null } };
  }

  if (productType === 'plastoformo') {
    const value: MedidasValidas = { longitud: null, grosor: null, ancho: null, largo: null };
    for (const campo of ['grosor', 'ancho', 'largo'] as const) {
      const valor = Number(body[campo]);
      if (body[campo] === undefined || body[campo] === null || body[campo] === '' || Number.isNaN(valor)) {
        return { ok: false, error: `El ${campo} (cm) es requerido para plastoformos` };
      }
      if (!Number.isInteger(valor) || valor < 1 || valor > 500) {
        return { ok: false, error: `El ${campo} debe ser un número entero entre 1 y 500 cm` };
      }
      value[campo] = valor;
    }
    return { ok: true, value };
  }

  return { ok: false, error: 'productType must be vigueta or plastoformo' };
}

/**
 * Busca un producto existente con las mismas medidas por tipo
 * (una vigueta por longitud, un plastoformo por grosor×ancho×largo).
 * `excluirId` permite ignorar el producto que se está editando.
 */
async function buscarDuplicado(
  productType: string,
  medidas: MedidasValidas,
  excluirId?: string
): Promise<{ id: string; name: string } | undefined> {
  const condiciones =
    productType === 'vigueta'
      ? [eq(products.productType, 'vigueta'), eq(products.longitud, String(medidas.longitud))]
      : [
          eq(products.productType, 'plastoformo'),
          eq(products.grosor, medidas.grosor!),
          eq(products.ancho, medidas.ancho!),
          eq(products.largo, medidas.largo!),
        ];
  if (excluirId) condiciones.push(ne(products.id, excluirId));

  const [duplicado] = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(and(...condiciones))
    .limit(1);
  return duplicado;
}

function mensajeDuplicado(productType: string, medidas: MedidasValidas, duplicado: { name: string }): string {
  if (productType === 'vigueta') {
    return `Ya existe una vigueta con longitud ${medidas.longitud} m ("${duplicado.name}")`;
  }
  return `Ya existe un plastoformo con medidas ${medidas.grosor}×${medidas.ancho}×${medidas.largo} cm ("${duplicado.name}")`;
}

/** true si el error es una violación de índice único de PostgreSQL (23505). */
function esDuplicadoDb(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

// GET /api/products?search=...
router.get('/', requireRole('admin', 'promoter'), async (req: Request, res: Response): Promise<void> => {
  try {
    const search = (req.query.search as string)?.replace(/['"]/g, '').trim() || '';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const whereClause = search ? ilike(products.name, `%${search}%`) : undefined;

    const [{ total }] = await db.select({ total: count() }).from(products).where(whereClause);
    const data = await db.select().from(products).where(whereClause).orderBy(desc(products.updatedAt)).limit(limit).offset(offset);

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
    res.status(500).json({ message: 'Error fetching products' });
  }
});

// GET /api/products/:id
router.get('/:id', requireRole('admin', 'promoter'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const [product] = await db.select().from(products).where(eq(products.id, id));

    if (!product) {
      res.status(404).json({ message: 'Product not found' });
      return;
    }

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching product' });
  }
});

// POST /api/products
router.post('/', requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, productType, price, description } = req.body;

    if (!name || !productType) {
      res.status(400).json({ message: 'Name and productType are required' });
      return;
    }

    if (!['vigueta', 'plastoformo'].includes(productType)) {
      res.status(400).json({ message: 'productType must be vigueta or plastoformo' });
      return;
    }

    const medidas = validarMedidas(productType, req.body as ProductBody);
    if (!medidas.ok) {
      res.status(400).json({ message: medidas.error });
      return;
    }

    const duplicado = await buscarDuplicado(productType, medidas.value);
    if (duplicado) {
      res.status(409).json({ message: mensajeDuplicado(productType, medidas.value, duplicado) });
      return;
    }

    const [product] = await db.insert(products)
      .values({
        name,
        productType,
        price,
        description,
        // decimal de drizzle se tipa como string
        longitud: medidas.value.longitud === null ? null : String(medidas.value.longitud),
        grosor: medidas.value.grosor,
        ancho: medidas.value.ancho,
        largo: medidas.value.largo,
      })
      .returning();

    res.status(201).json(product);
  } catch (error) {
    if (esDuplicadoDb(error)) {
      res.status(409).json({ message: 'Ya existe un producto con esas medidas' });
      return;
    }
    res.status(500).json({ message: 'Error creating product' });
  }
});

// PUT /api/products/:id
router.put('/:id', requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { name, productType, price, description } = req.body;

    if (productType && !['vigueta', 'plastoformo'].includes(productType)) {
      res.status(400).json({ message: 'productType must be vigueta or plastoformo' });
      return;
    }

    const [existente] = await db.select().from(products).where(eq(products.id, id));
    if (!existente) {
      res.status(404).json({ message: 'Product not found' });
      return;
    }

    const tipoFinal = productType ?? existente.productType;
    const medidas = validarMedidas(tipoFinal, req.body as ProductBody);
    if (!medidas.ok) {
      res.status(400).json({ message: medidas.error });
      return;
    }

    const duplicado = await buscarDuplicado(tipoFinal, medidas.value, id);
    if (duplicado) {
      res.status(409).json({ message: mensajeDuplicado(tipoFinal, medidas.value, duplicado) });
      return;
    }

    const [product] = await db.update(products)
      .set({
        name,
        productType,
        price,
        description,
        // decimal de drizzle se tipa como string
        longitud: medidas.value.longitud === null ? null : String(medidas.value.longitud),
        grosor: medidas.value.grosor,
        ancho: medidas.value.ancho,
        largo: medidas.value.largo,
        updatedAt: new Date(),
      })
      .where(eq(products.id, id))
      .returning();

    res.json(product);
  } catch (error) {
    if (esDuplicadoDb(error)) {
      res.status(409).json({ message: 'Ya existe un producto con esas medidas' });
      return;
    }
    res.status(500).json({ message: 'Error updating product' });
  }
});

// DELETE /api/products/:id
router.delete('/:id', requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    await db.delete(products).where(eq(products.id, id));
    res.json({ message: 'Product deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting product' });
  }
});

export default router;

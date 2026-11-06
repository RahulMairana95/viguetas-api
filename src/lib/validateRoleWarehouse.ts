import { eq } from 'drizzle-orm';
import { db } from '../db';
import { warehouses, Rol } from '../db/schema';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reglas de almacén por rol:
// - admin: el almacén es OPCIONAL; si tiene, solo puede ser de tipo fábrica.
// - promoter: el almacén es OBLIGATORIO y debe ser de tipo tienda.
// Devuelve { ok:false, error } o { ok:true, warehouseId }.
export async function validateRoleWarehouse(
  role: Rol,
  warehouseId?: string | null
): Promise<{ ok: false; error: string } | { ok: true; warehouseId: string | null }> {
  if (!warehouseId) {
    if (role === 'admin') {
      return { ok: true, warehouseId: null };
    }
    return {
      ok: false,
      error: 'Un promotor debe tener un almacén de tipo tienda asignado',
    };
  }

  if (!UUID_REGEX.test(warehouseId)) {
    return { ok: false, error: 'El almacén indicado no es válido' };
  }

  const [almacen] = await db.select().from(warehouses).where(eq(warehouses.id, warehouseId));
  if (!almacen) return { ok: false, error: 'El almacén indicado no existe' };

  // El tipo de almacén esperado según el rol (fábrica/tienda).
  const tipoEsperado = role === 'admin' ? 'factory' : 'store';
  if (almacen.type !== tipoEsperado) {
    return {
      ok: false,
      error: role === 'admin'
        ? 'Un usuario admin solo puede asignarse a un almacén de tipo fábrica'
        : 'Un promotor solo puede asignarse a un almacén de tipo tienda',
    };
  }

  return { ok: true, warehouseId };
}

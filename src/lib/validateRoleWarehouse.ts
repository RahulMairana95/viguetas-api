import { eq } from 'drizzle-orm';
import { db } from '../db';
import { warehouses, Rol } from '../db/schema';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Regla dura: un admin solo puede estar en un almacén de tipo fábrica;
// un store, solo en uno de tipo tienda. Sin almacén, el rol no es válido.
// Devuelve { ok:false, error } o { ok:true, warehouseId }.
export async function validateRoleWarehouse(
  role: Rol,
  warehouseId?: string | null
): Promise<{ ok: false; error: string } | { ok: true; warehouseId: string }> {
  if (!warehouseId) {
    return {
      ok: false,
      error: role === 'admin'
        ? 'Un usuario admin debe tener un almacén de tipo fábrica asignado'
        : 'Un usuario de tienda debe tener un almacén de tipo tienda asignado',
    };
  }

  if (!UUID_REGEX.test(warehouseId)) {
    return { ok: false, error: 'El almacén indicado no es válido' };
  }

  const [almacen] = await db.select().from(warehouses).where(eq(warehouses.id, warehouseId));
  if (!almacen) return { ok: false, error: 'El almacén indicado no existe' };

  const tipoEsperado = role === 'admin' ? 'factory' : 'store';
  if (almacen.type !== tipoEsperado) {
    return {
      ok: false,
      error: role === 'admin'
        ? 'Un usuario admin solo puede asignarse a un almacén de tipo fábrica'
        : 'Un usuario de tienda solo puede asignarse a un almacén de tipo tienda',
    };
  }

  return { ok: true, warehouseId };
}

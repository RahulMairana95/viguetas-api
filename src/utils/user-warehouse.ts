import { eq } from 'drizzle-orm';
import { db } from '../db';
import { warehouses } from '../db/schema';

export const ROLES = ['admin', 'promoter', 'superadmin'] as const;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reglas de asignación de almacén por rol:
// - superadmin: nunca tiene almacén (traslada/vende de cualquier almacén)
// - admin: obligatorio (fábrica o tienda)
// - promoter: obligatorio y debe ser de tipo tienda (nunca fábrica)
// Devuelve mensaje de error, o null si la combinación es válida.
export async function validateWarehouseForRole(
  role: string,
  warehouseId: string | null | undefined
): Promise<string | null> {
  if (role === 'superadmin') {
    return warehouseId ? 'Un superadmin no puede tener un almacén asignado' : null;
  }

  if (!warehouseId) {
    return role === 'admin'
      ? 'Un admin debe tener un almacén asignado (fábrica o tienda)'
      : 'Un promotor debe tener un almacén de tienda asignado';
  }

  if (!UUID_REGEX.test(warehouseId)) {
    return 'El almacén indicado no es válido';
  }

  const [warehouse] = await db
    .select({ type: warehouses.type })
    .from(warehouses)
    .where(eq(warehouses.id, warehouseId));

  if (!warehouse) return 'El almacén indicado no existe';
  if (role === 'promoter' && warehouse.type !== 'store') {
    return 'Un promotor solo puede tener un almacén de tienda, no de fábrica';
  }
  return null;
}

import { Request } from 'express';

type Resultado = { warehouseId: string | null };

// Almacén propio del usuario: para promoter es el origen de todas sus líneas;
// para admin es solo el origen por defecto (si tiene fábrica asignada), y si no
// tiene almacén puede elegir libremente el origen en cada línea.
export function resolveWarehouse(req: Request): Resultado {
  return { warehouseId: req.userAlmacenId ?? null };
}

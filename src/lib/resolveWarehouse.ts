import { Request } from 'express';

type Resultado = { warehouseId: string } | { error: string };

// Almacén propio del usuario: para store es el origen de todas sus líneas;
// para admin es solo el origen por defecto (fábrica), puede elegir otro.
export function resolveWarehouse(req: Request): Resultado {
  if (!req.userAlmacenId) {
    return { error: 'Tu usuario no tiene un almacén asignado. Contacta al administrador.' };
  }
  return { warehouseId: req.userAlmacenId };
}

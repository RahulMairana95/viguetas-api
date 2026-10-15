import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';

// Guardas de negocio para no dejar el sistema sin administradores.
// Un admin no se puede desactivar a sí mismo, y siempre debe quedar
// al menos un admin activo (para no bloquear el acceso a la gestión).

export async function esUltimoAdminActivo(id: string): Promise<boolean> {
  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
  return admins.length === 1 && admins[0].id === id;
}

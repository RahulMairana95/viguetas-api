import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users, warehouses } from '../db/schema';

// Script de emergencia / primer admin.
//
// Crea o promueve a admin al usuario de ADMIN_EMAIL, asignado al almacén de
// tipo fábrica, ACTIVO y PROTEGIDO (no se podrá desactivar ni cambiar de rol
// desde la app; para quitarle la protección se hace con un update en la BD).
//
// Uso en PowerShell (la contraseña nunca se queda en un archivo):
//   $env:ADMIN_EMAIL="correo@..."; $env:ADMIN_PASSWORD="una-clave-larga"; pnpm create:admin
//   Remove-Item Env:ADMIN_PASSWORD
//
// Para recuperar el acceso si el admin olvidó su contraseña, agregar antes:
//   $env:ADMIN_RESET_PASSWORD="true"
async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? 'Administrador';
  const resetPassword = process.env.ADMIN_RESET_PASSWORD === 'true';

  if (!email || !password) throw new Error('Define ADMIN_EMAIL y ADMIN_PASSWORD');
  if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');

  const [fabrica] = await db.select().from(warehouses).where(eq(warehouses.type, 'factory'));
  if (!fabrica) throw new Error('Crea primero el almacén de tipo fábrica');

  const [existente] = await db.select().from(users).where(eq(users.email, email));

  if (existente) {
    await db.update(users).set({
      role: 'admin',
      warehouseId: fabrica.id,
      isActive: true,
      isProtected: true,
      ...(resetPassword ? { password: await bcrypt.hash(password, 10) } : {}),
      updatedAt: new Date(),
    }).where(eq(users.id, existente.id));
    console.log('Usuario existente actualizado: admin, activo y protegido');
  } else {
    await db.insert(users).values({
      email,
      name,
      password: await bcrypt.hash(password, 10),
      role: 'admin',
      warehouseId: fabrica.id,
      isActive: true,
      isProtected: true,
    });
    console.log('Admin creado: activo y protegido');
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

import { Request, Response } from 'express';
import { eq, or, ilike, count } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from '../db';
import { users, warehouses, refreshTokens, Rol } from '../db/schema';
import { validateRoleWarehouse } from '../lib/validateRoleWarehouse';
import { esUltimoAdminActivo } from '../lib/userGuards';

// Columnas visibles en listados. Nunca se selecciona `password`.
const userColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  lastName: users.lastName,
  role: users.role,
  warehouseId: users.warehouseId,
  warehouseName: warehouses.name,
  isActive: users.isActive,
  isProtected: users.isProtected,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

const ROLES_VALIDOS: Rol[] = ['admin', 'promoter'];

// GET /api/users?search=...
export async function listUsers(req: Request, res: Response): Promise<void> {
  try {
    const search = (req.query.search as string)?.replace(/['"]/g, '').trim() || '';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;

    const whereClause = search ? or(
      ilike(users.name, `%${search}%`),
      ilike(users.lastName, `%${search}%`),
      ilike(users.email, `%${search}%`)
    ) : undefined;

    const [{ total }] = await db.select({ total: count() }).from(users).where(whereClause);

    const data = await db
      .select(userColumns)
      .from(users)
      .leftJoin(warehouses, eq(users.warehouseId, warehouses.id))
      .where(whereClause)
      .orderBy(users.name)
      .limit(limit)
      .offset(offset);

    res.json({
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching users' });
  }
}

// POST /api/users
//
// Sin spread del body: isProtected e isActive nunca entran por aquí.
export async function createUser(req: Request, res: Response): Promise<void> {
  try {
    const { email, password, name, lastName, role, warehouseId } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ message: 'Correo, contraseña y nombre son requeridos' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ message: 'La contraseña debe tener al menos 8 caracteres' });
      return;
    }
    if (!ROLES_VALIDOS.includes(role)) {
      res.status(400).json({ message: 'Rol inválido: debe ser admin o promoter' });
      return;
    }

    const check = await validateRoleWarehouse(role, warehouseId);
    if (!check.ok) {
      res.status(400).json({ message: check.error });
      return;
    }

    const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existingUser) {
      res.status(409).json({ message: 'Ya existe un usuario con ese correo' });
      return;
    }

    const [nuevo] = await db.insert(users).values({
      email,
      name,
      lastName: lastName || null,
      role,
      warehouseId: check.warehouseId,
      password: await bcrypt.hash(password, 10),
      // isProtected e isActive quedan con su valor por defecto (false / true)
    }).returning({ id: users.id });

    res.status(201).json({ id: nuevo.id });
  } catch (error: any) {
    if ((error?.code ?? error?.cause?.code) === '23505') {
      res.status(409).json({ message: 'Ya existe un usuario con ese correo' });
      return;
    }
    res.status(500).json({ message: 'Error creating user' });
  }
}

// PATCH /api/users/:id
export async function updateUser(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const [actual] = await db.select().from(users).where(eq(users.id, id));
    if (!actual) {
      res.status(404).json({ message: 'Usuario no encontrado' });
      return;
    }

    const rolFinal: Rol = req.body.role ?? actual.role;
    const almacenFinal = 'warehouseId' in req.body ? req.body.warehouseId : actual.warehouseId;

    if (!ROLES_VALIDOS.includes(rolFinal)) {
      res.status(400).json({ message: 'Rol inválido: debe ser admin o promoter' });
      return;
    }

    // Guardas al cambiar de rol
    if (rolFinal !== actual.role) {
      if (id === req.userId) {
        res.status(400).json({ message: 'No puedes cambiar tu propio rol' });
        return;
      }
      if (actual.isProtected) {
        res.status(403).json({ message: 'Un usuario protegido no puede cambiar de rol' });
        return;
      }
      if (actual.role === 'admin' && (await esUltimoAdminActivo(id))) {
        res.status(400).json({ message: 'Debe quedar al menos un admin activo' });
        return;
      }
    }

    const check = await validateRoleWarehouse(rolFinal, almacenFinal);
    if (!check.ok) {
      res.status(400).json({ message: check.error });
      return;
    }

    if (req.body.email) {
      const [dupe] = await db.select({ id: users.id }).from(users).where(eq(users.email, req.body.email));
      if (dupe && dupe.id !== id) {
        res.status(409).json({ message: 'Ya existe un usuario con ese correo' });
        return;
      }
    }

    await db.update(users).set({
      name: req.body.name ?? actual.name,
      lastName: 'lastName' in req.body ? req.body.lastName : actual.lastName,
      email: req.body.email ?? actual.email,
      role: rolFinal,
      warehouseId: check.warehouseId,
      updatedAt: new Date(),
    }).where(eq(users.id, id));

    // El rol y el almacén viajan en el token: se fuerza un nuevo inicio de sesión
    if (rolFinal !== actual.role || check.warehouseId !== actual.warehouseId) {
      await db.delete(refreshTokens).where(eq(refreshTokens.userId, id));
    }

    res.json({ ok: true });
  } catch (error: any) {
    if ((error?.code ?? error?.cause?.code) === '23505') {
      res.status(409).json({ message: 'Ya existe un usuario con ese correo' });
      return;
    }
    res.status(500).json({ message: 'Error updating user' });
  }
}

// PATCH /api/users/:id/password — el admin cambia la contraseña de un usuario
export async function changePassword(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const { password } = req.body;

    if (!password || password.length < 8) {
      res.status(400).json({ message: 'La contraseña debe tener al menos 8 caracteres' });
      return;
    }

    const [actualizado] = await db.update(users)
      .set({ password: await bcrypt.hash(password, 10), updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });

    if (!actualizado) {
      res.status(404).json({ message: 'Usuario no encontrado' });
      return;
    }

    // Cerrar sesiones para forzar el nuevo login con la contraseña nueva
    await db.delete(refreshTokens).where(eq(refreshTokens.userId, id));

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: 'Error updating password' });
  }
}

// PATCH /api/users/:id/deactivate
export async function deactivateUser(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;

    if (id === req.userId) {
      res.status(400).json({ message: 'No puedes desactivar tu propio usuario' });
      return;
    }

    const [objetivo] = await db.select().from(users).where(eq(users.id, id));
    if (!objetivo) {
      res.status(404).json({ message: 'Usuario no encontrado' });
      return;
    }
    if (objetivo.isProtected) {
      res.status(403).json({ message: 'Este usuario está protegido: no se puede desactivar ni cambiar de rol' });
      return;
    }
    if (objetivo.role === 'admin' && (await esUltimoAdminActivo(id))) {
      res.status(400).json({ message: 'Debe quedar al menos un admin activo' });
      return;
    }

    await db.update(users).set({ isActive: false, updatedAt: new Date() }).where(eq(users.id, id));
    await db.delete(refreshTokens).where(eq(refreshTokens.userId, id)); // cierra sus sesiones

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: 'Error deactivating user' });
  }
}

// PATCH /api/users/:id/activate
export async function activateUser(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;

    const [actualizado] = await db.update(users)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning({ id: users.id });

    if (!actualizado) {
      res.status(404).json({ message: 'Usuario no encontrado' });
      return;
    }

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: 'Error activating user' });
  }
}

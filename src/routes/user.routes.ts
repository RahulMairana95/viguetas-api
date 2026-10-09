import { Router, Request, Response } from 'express';
import { eq, count, or, ilike, desc } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from '../db';
import { users, refreshTokens } from '../db/schema';
import { authMiddleware, roleMiddleware } from '../middleware/auth.middleware';
import { ROLES, validateWarehouseForRole } from '../utils/user-warehouse';

const router: ReturnType<typeof Router> = Router();

router.use(authMiddleware);

const userColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  lastName: users.lastName,
  role: users.role,
  warehouseId: users.warehouseId,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

// GET /api/users?search=...
router.get('/', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
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
    const data = await db.select(userColumns).from(users).where(whereClause).orderBy(desc(users.updatedAt)).limit(limit).offset(offset);

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
    res.status(500).json({ message: 'Error fetching users' });
  }
});

// GET /api/users/:id
router.get('/:id', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const [user] = await db.select(userColumns).from(users).where(eq(users.id, id));

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user' });
  }
});

// POST /api/users
router.post('/', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name, lastName, role, warehouseId } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ message: 'Email, password and name are required' });
      return;
    }

    if (role && !(ROLES as readonly string[]).includes(role)) {
      res.status(400).json({ message: 'Role must be admin, store or superadmin' });
      return;
    }

    // Solo un superadmin puede crear usuarios superadmin
    if (role === 'superadmin' && req.user!.role !== 'superadmin') {
      res.status(403).json({ message: 'Only a superadmin can create superadmin users' });
      return;
    }

    const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existingUser) {
      res.status(409).json({ message: 'Email already registered' });
      return;
    }

    const finalRole = role || 'promoter';
    const finalWarehouseId = warehouseId || null;
    const warehouseError = await validateWarehouseForRole(finalRole, finalWarehouseId);
    if (warehouseError) {
      res.status(400).json({ message: warehouseError });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [user] = await db.insert(users).values({
      email,
      password: hashedPassword,
      name,
      lastName: lastName || null,
      role: finalRole,
      warehouseId: finalWarehouseId,
    }).returning(userColumns);

    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({ message: 'Error creating user' });
  }
});

// PUT /api/users/:id
router.put('/:id', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { email, password, name, lastName, role, warehouseId } = req.body;

    const [existing] = await db.select({ role: users.role, warehouseId: users.warehouseId })
      .from(users).where(eq(users.id, id));

    if (!existing) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    if (role && !(ROLES as readonly string[]).includes(role)) {
      res.status(400).json({ message: 'Role must be admin, store or superadmin' });
      return;
    }

    // Solo un superadmin puede asignar el rol superadmin
    if (role === 'superadmin' && req.user!.role !== 'superadmin') {
      res.status(403).json({ message: 'Only a superadmin can assign the superadmin role' });
      return;
    }

    if (email) {
      const [existingUser] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (existingUser && existingUser.id !== id) {
        res.status(409).json({ message: 'Email already registered' });
        return;
      }
    }

    const finalRole = role !== undefined ? role : existing.role;
    const finalWarehouseId = warehouseId !== undefined
      ? (warehouseId || null)
      : existing.warehouseId;
    const warehouseError = await validateWarehouseForRole(finalRole, finalWarehouseId);
    if (warehouseError) {
      res.status(400).json({ message: warehouseError });
      return;
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (email !== undefined) updateData.email = email;
    if (name !== undefined) updateData.name = name;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (role !== undefined) updateData.role = role;
    if (warehouseId !== undefined) updateData.warehouseId = finalWarehouseId;
    if (password !== undefined && password !== '') updateData.password = await bcrypt.hash(password, 10);

    const [user] = await db.update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning(userColumns);

    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Error updating user' });
  }
});

// DELETE /api/users/:id
router.delete('/:id', roleMiddleware('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    await db.delete(refreshTokens).where(eq(refreshTokens.userId, id));

    const [deleted] = await db.delete(users)
      .where(eq(users.id, id))
      .returning({ id: users.id });

    if (!deleted) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting user' });
  }
});

export default router;
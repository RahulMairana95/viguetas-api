import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import { users, refreshTokens } from '../db/schema';
import { config } from '../config';
import { authMiddleware, AuthPayload } from '../middleware/auth.middleware';

const router: ReturnType<typeof Router> = Router();

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name, lastName, role, warehouseId } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ message: 'Email, password and name are required', status: 'error', data: null });
      return;
    }

    const [existingUser] = await db.select().from(users).where(eq(users.email, email));
    if (existingUser) {
      res.status(409).json({ message: 'Email already registered', status: 'error', data: null });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [user] = await db.insert(users).values({
      email,
      password: hashedPassword,
      name,
      lastName: lastName || null,
      role: role || 'store',
      warehouseId: warehouseId || null,
    }).returning({
      id: users.id,
      email: users.email,
      name: users.name,
      lastName: users.lastName,
      role: users.role,
      warehouseId: users.warehouseId,
      createdAt: users.createdAt,
    });

    res.status(201).json({ message: 'User created', status: 'success', data: user });
  } catch (error) {
    res.status(500).json({ message: 'Error creating user', status: 'error', data: null });
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ message: 'Email and password are required', status: 'error', data: null });
      return;
    }

    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) {
      res.status(401).json({ message: 'Invalid credentials', status: 'error', data: null });
      return;
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      res.status(401).json({ message: 'Invalid credentials', status: 'error', data: null });
      return;
    }

    const payload: AuthPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = jwt.sign(payload, config.jwtSecret, { expiresIn: '1h' });
    const refreshToken = jwt.sign(payload, config.jwtRefreshSecret, { expiresIn: '7d' });

    await db.insert(refreshTokens).values({
      token: refreshToken,
      userId: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    res.json({
      message: 'Login successful',
      status: 'success',
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        lastName: user.lastName,
        role: user.role,
        warehouseId: user.warehouseId,
        accessToken,
        refreshToken,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Error during login', status: 'error', data: null });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      res.status(400).json({ message: 'Refresh token required', status: 'error', data: null });
      return;
    }

    const [storedToken] = await db.select().from(refreshTokens).where(eq(refreshTokens.token, refreshToken));

    if (!storedToken || storedToken.expiresAt < new Date()) {
      res.status(401).json({ message: 'Invalid or expired refresh token', status: 'error', data: null });
      return;
    }

    const decoded = jwt.verify(refreshToken, config.jwtRefreshSecret) as AuthPayload;

    const newAccessToken = jwt.sign(
      { userId: decoded.userId, email: decoded.email, role: decoded.role },
      config.jwtSecret,
      { expiresIn: '1h' }
    );

    res.json({ message: 'Token refreshed', status: 'success', data: { accessToken: newAccessToken } });
  } catch (error) {
    res.status(401).json({ message: 'Invalid refresh token', status: 'error', data: null });
  }
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      await db.delete(refreshTokens).where(eq(refreshTokens.token, refreshToken));
    }

    res.json({ message: 'Logged out successfully', status: 'success', data: null });
  } catch (error) {
    res.status(500).json({ message: 'Error during logout', status: 'error', data: null });
  }
});

// GET /api/auth/profile
router.get('/profile', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const [user] = await db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      lastName: users.lastName,
      role: users.role,
      warehouseId: users.warehouseId,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.id, req.user!.userId));

    if (!user) {
      res.status(404).json({ message: 'User not found', status: 'error', data: null });
      return;
    }

    res.json({ message: 'User found', status: 'success', data: user });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user', status: 'error', data: null });
  }
});

// PATCH /api/auth/profile
router.patch('/profile', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, lastName, password, role, warehouseId } = req.body;

    if (name === undefined && lastName === undefined && password === undefined && role === undefined && warehouseId === undefined) {
      res.status(400).json({ message: 'No fields to update', status: 'error', data: null });
      return;
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };

    if (name !== undefined) updateData.name = name;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (password !== undefined) updateData.password = await bcrypt.hash(password, 10);
    if (role !== undefined) updateData.role = role;
    if (warehouseId !== undefined) updateData.warehouseId = warehouseId;

    const [user] = await db.update(users)
      .set(updateData)
      .where(eq(users.id, req.user!.userId))
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        lastName: users.lastName,
        role: users.role,
        warehouseId: users.warehouseId,
        updatedAt: users.updatedAt,
      });

    if (!user) {
      res.status(404).json({ message: 'User not found', status: 'error', data: null });
      return;
    }

    res.json({ message: 'User updated', status: 'success', data: user });
  } catch (error) {
    res.status(500).json({ message: 'Error updating user', status: 'error', data: null });
  }
});

// DELETE /api/auth/profile
router.delete('/profile', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    await db.delete(refreshTokens).where(eq(refreshTokens.userId, req.user!.userId));

    const [deleted] = await db.delete(users)
      .where(eq(users.id, req.user!.userId))
      .returning({ id: users.id, email: users.email });

    if (!deleted) {
      res.status(404).json({ message: 'User not found', status: 'error', data: null });
      return;
    }

    res.json({ message: 'User deleted', status: 'success', data: null });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting user', status: 'error', data: null });
  }
});

export default router;

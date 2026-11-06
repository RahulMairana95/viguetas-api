import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { Rol } from '../db/schema';

export interface AuthPayload {
  userId: string;
  email: string;
  role: Rol;
  // El almacén viaja en el token para que los controladores no tengan que
  // consultarlo en cada request. Se refresca al hacer refresh del token.
  warehouseId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      userId: string;
      userRol: Rol;
      userAlmacenId: string | null;
    }
  }
}

export const requireAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Token not provided' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AuthPayload;
    req.userId = decoded.userId;
    req.userRol = decoded.role;
    req.userAlmacenId = decoded.warehouseId ?? null;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

// Con 2 roles no hay pase automático: admin y promoter se validan igual.
export function requireRole(...rolesPermitidos: Rol[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const rol = req.userRol;

    if (!rol) {
      res.status(401).json({ message: 'No autenticado' });
      return;
    }

    if (!rolesPermitidos.includes(rol)) {
      res.status(403).json({ message: 'No tienes permiso para realizar esta acción' });
      return;
    }

    next();
  };
}

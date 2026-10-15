import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.middleware';
import {
  listUsers, createUser, updateUser, changePassword, deactivateUser, activateUser,
} from '../controllers/users.controller';

const router: ReturnType<typeof Router> = Router();

router.use(requireAuth);

// Solo el admin gestiona usuarios. No existe DELETE /users/:id:
// los usuarios se desactivan, no se borran.
router.get('/', requireRole('admin'), listUsers);
router.post('/', requireRole('admin'), createUser);
router.patch('/:id', requireRole('admin'), updateUser);
router.patch('/:id/password', requireRole('admin'), changePassword);
router.patch('/:id/deactivate', requireRole('admin'), deactivateUser);
router.patch('/:id/activate', requireRole('admin'), activateUser);

export default router;

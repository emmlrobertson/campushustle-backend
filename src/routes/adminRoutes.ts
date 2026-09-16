import { Router } from 'express';
import {
  getReports,
  resolveReport,
  updateUserStatus,
  moderateHustle,
  getModerationLogs,
} from '../controllers/adminController';
import {
  authenticateToken,
  requireAdminOrModerator,
  requireAdmin,
} from '../middleware/authMiddleware';

const router = Router();

// All admin routes strictly enforce authenticated token and server-side role validation
router.use(authenticateToken);
router.use(requireAdminOrModerator);

router.get('/reports', getReports);
router.patch('/reports/:id', resolveReport);
router.patch('/hustles/:id/status', moderateHustle);
router.get('/logs', getModerationLogs);

// User status deactivation requires full ADMIN role
router.patch('/users/:id/status', requireAdmin, updateUserStatus);

export default router;

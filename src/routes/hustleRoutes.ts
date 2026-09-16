import { Router } from 'express';
import {
  getAllHustles,
  getHustleById,
  getMyHustles,
  createHustle,
  updateHustle,
  deleteHustle,
  toggleHustleStatus,
  getHustleReviews,
  createHustleReview,
  uploadHustleImageHandler,
  uploadHustleImagesForListingHandler,
  toggleFavoriteHustle,
  getMyFavoriteHustles,
} from '../controllers/hustleController';
import { authenticateToken } from '../middleware/authMiddleware';
import {
  uploadSingleImage,
  validateImageBuffer,
  handleUploadErrors,
} from '../middleware/uploadMiddleware';

const router = Router();

// Protected routes (requires valid verified student JWT token)
router.get('/my/listings', authenticateToken, getMyHustles);
router.get('/my/favorites', authenticateToken, getMyFavoriteHustles);
router.post('/', authenticateToken, createHustle);
router.put('/:id', authenticateToken, updateHustle);
router.patch('/:id', authenticateToken, updateHustle);
router.delete('/:id', authenticateToken, deleteHustle);
router.patch('/:id/status', authenticateToken, toggleHustleStatus);
router.post('/:id/favorite', authenticateToken, toggleFavoriteHustle);
router.post('/:id/reviews', authenticateToken, createHustleReview);

// Image upload routes
router.post(
  '/upload-image',
  authenticateToken,
  uploadSingleImage,
  handleUploadErrors,
  validateImageBuffer,
  uploadHustleImageHandler
);

router.post(
  '/:id/images',
  authenticateToken,
  uploadSingleImage,
  handleUploadErrors,
  validateImageBuffer,
  uploadHustleImagesForListingHandler
);

// Public routes
router.get('/', getAllHustles);
router.get('/:id', getHustleById);
router.get('/:id/reviews', getHustleReviews);

export default router;



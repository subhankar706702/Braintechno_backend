import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { SocialPostController } from '../controllers/social-post.controller';

const router = Router();
router.use(requireAuth);

router.get('/', SocialPostController.list);
router.get('/:id', SocialPostController.get);
router.post('/', SocialPostController.create);
router.patch('/:id', SocialPostController.update);
router.delete('/:id', SocialPostController.remove);
router.post('/:id/publish', SocialPostController.publish);
router.post('/:id/schedule', SocialPostController.schedule);
router.post('/:id/cancel', SocialPostController.cancel);

export default router;

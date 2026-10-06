import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';
import { SocialAccountController } from '../controllers/social-account.controller.js';

const router = Router();

router.use(requireAuth);

router.get('/', SocialAccountController.list);
router.get('/:platform', SocialAccountController.getByPlatform);
router.post('/connect', SocialAccountController.connect);
router.patch('/:id', SocialAccountController.update);
router.post('/:id/disconnect', SocialAccountController.disconnect);

export default router;

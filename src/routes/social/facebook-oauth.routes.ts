import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import { FacebookOAuthController } from '../../controllers/social/facebook-oauth.controller.js';

const router = Router();

// OAuth start needs the logged-in BRAIN TECHNO user context.
router.get('/facebook', requireAuth, FacebookOAuthController.start);

// OAuth callback is intentionally public because Meta redirects the browser here.
router.get('/facebook/callback', FacebookOAuthController.callback);

// Page selection is protected by a one-time server-generated selection token.
router.post('/facebook/select-page', FacebookOAuthController.selectPage);

export default router;

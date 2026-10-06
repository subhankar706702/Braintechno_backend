import { Router } from 'express';

import socialAccountRoutes from './social-account.routes.js';
import facebookOAuthRoutes from './facebook-oauth.routes.js';

const router = Router();

router.use('/accounts', socialAccountRoutes);
router.use('/oauth', facebookOAuthRoutes);

export default router;

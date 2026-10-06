import { Router } from 'express';

import socialAccountRoutes from './social-account.routes.js';

const router = Router();

router.use('/accounts', socialAccountRoutes);

export default router;

import { Router } from 'express';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { Business } from '../models/business.model.js';
import { Campaign } from '../models/campaign.model.js';
import { Interaction } from '../models/interaction.model.js';
import { Template } from '../models/template.model.js';
import { User } from '../models/user.model.js';
import { Page } from '../models/page.model.js';
import { serializeDocument } from '../utils/serialize.js';

const router = Router();
router.use(requireAuth, requireAdmin);

router.get('/summary', async (_req, res, next) => {
  try {
    const [businesses, users, templates, pages, campaigns, interactions] = await Promise.all([
      Business.countDocuments(), User.countDocuments(), Template.countDocuments(), Page.countDocuments(), Campaign.countDocuments(), Interaction.countDocuments()
    ]);
    return res.json({ businesses, users, templates, pages, campaigns, interactions });
  } catch (e) { return next(e); }
});

router.get('/businesses', async (_req, res, next) => {
  try { return res.json((await Business.find().sort({ updatedAt: -1 }).lean()).map(serializeDocument)); }
  catch (e) { return next(e); }
});
router.get('/templates', async (_req, res, next) => {
  try { return res.json((await Template.find().sort({ updatedAt: -1 }).lean()).map(serializeDocument)); }
  catch (e) { return next(e); }
});
router.get('/campaigns', async (_req, res, next) => {
  try { return res.json((await Campaign.find().sort({ updatedAt: -1 }).lean()).map(serializeDocument)); }
  catch (e) { return next(e); }
});
router.get('/users', async (_req, res, next) => {
  try {
    const users = await User.find().select('-passwordHash').sort({ updatedAt: -1 }).lean();
    return res.json(users.map(serializeDocument));
  } catch (e) { return next(e); }
});

export default router;

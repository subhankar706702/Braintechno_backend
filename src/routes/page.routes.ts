import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { Page } from '../models/page.model.js';
import { normalizeLegacyDesign, serializeDocument } from '../utils/serialize.js';

const router = Router();

router.get('/public/:slug', async (req, res, next) => {
  try {
    const item = await Page.findOne({ slug: req.params.slug, status: 'published' }).lean();
    if (!item) return res.status(404).json({ message: 'Page not found.' });
    return res.json(serializeDocument(item as any));
  } catch (e) { return next(e); }
});

router.use(requireAuth);
router.get('/', async (req, res, next) => {
  try {
    const filter = req.auth!.role === 'admin' ? {} : { businessId: req.auth!.businessId };
    return res.json((await Page.find(filter).sort({ updatedAt: -1 }).lean()).map(serializeDocument));
  } catch (e) { return next(e); }
});
router.post('/', async (req, res, next) => {
  try {
    if (!req.auth!.businessId) return res.status(400).json({ message: 'No business is linked to this account.' });
    const item = await Page.create({ ...req.body, design: normalizeLegacyDesign(req.body?.design), businessId: req.auth!.businessId });
    return res.status(201).json(serializeDocument(item.toObject() as any));
  } catch (e) { return next(e); }
});
router.put('/:id', async (req, res, next) => {
  try {
    const filter: any = { _id: req.params.id };
    if (req.auth!.role !== 'admin') filter.businessId = req.auth!.businessId;
    const item = await Page.findOneAndUpdate(filter, { $set: { ...req.body, design: normalizeLegacyDesign(req.body?.design) } }, { new: true, runValidators: true }).lean();
    if (!item) return res.status(404).json({ message: 'Page not found.' });
    return res.json(serializeDocument(item as any));
  } catch (e) { return next(e); }
});
export default router;

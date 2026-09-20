import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { Campaign } from '../models/campaign.model.js';
import { Interaction } from '../models/interaction.model.js';
import { serializeDocument } from '../utils/serialize.js';

const router = Router();
router.get('/public/:slug', async (req, res, next) => {
  try {
    const item = await Campaign.findOne({ slug: req.params.slug, status: 'published' }).lean();
    if (!item) return res.status(404).json({ message: 'Campaign not found.' });
    return res.json(serializeDocument(item as any));
  } catch (e) { return next(e); }
});
router.post('/public/:slug/interactions', async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({ slug: req.params.slug, status: 'published' }).select('_id businessId');
    if (!campaign) return res.status(404).json({ message: 'Campaign not found.' });
    await Interaction.create({ businessId: campaign.businessId, campaignId: campaign._id, event: req.body?.event || 'PAGE_VIEW', source: req.body?.source, metadata: req.body?.metadata });
    return res.status(202).json({ ok: true });
  } catch (e) { return next(e); }
});
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const filter = req.auth!.role === 'admin' ? {} : { businessId: req.auth!.businessId };
    return res.json((await Campaign.find(filter).sort({ updatedAt: -1 }).lean()).map(serializeDocument));
  } catch (e) { return next(e); }
});
router.post('/', requireAuth, async (req, res, next) => {
  try {
    if (!req.auth!.businessId) return res.status(400).json({ message: 'No business is linked to this account.' });
    const existing = await Campaign.exists({ slug: req.body?.slug });
    if (existing) return res.status(409).json({ message: 'This public slug is already in use.' });
    const item = await Campaign.create({ ...req.body, businessId: req.auth!.businessId });
    return res.status(201).json(serializeDocument(item.toObject() as any));
  } catch (e) { return next(e); }
});
router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    const filter: any = { _id: req.params.id };
    if (req.auth!.role !== 'admin') filter.businessId = req.auth!.businessId;
    const item = await Campaign.findOneAndUpdate(filter, { $set: req.body }, { new: true, runValidators: true }).lean();
    if (!item) return res.status(404).json({ message: 'Campaign not found.' });
    return res.json(serializeDocument(item as any));
  } catch (e) { return next(e); }
});
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const filter: any = { _id: req.params.id };
    if (req.auth!.role !== 'admin') filter.businessId = req.auth!.businessId;
    const item = await Campaign.findOneAndDelete(filter);
    if (!item) return res.status(404).json({ message: 'Campaign not found.' });
    return res.status(204).send();
  } catch (e) { return next(e); }
});
export default router;

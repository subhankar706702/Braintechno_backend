import { Router } from 'express';

import { requireAuth } from '../middleware/auth';
import { Business } from '../models/business.model';
import { Campaign } from '../models/campaign.model';
import { Interaction } from '../models/interaction.model';
import { Template } from '../models/template.model';
import { serializeDocument } from '../utils/serialize';
import { CampaignCategory, CampaignStatus } from '../interface';

const router = Router();
const PUBLIC_DOMAIN = 'https://www.braintechno.in';
const BLANK_TEMPLATE_ID = '__blank__';

const normalizeSlug = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const toDateOrNull = (value: unknown): Date | null => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const toTitleFromSlug = (value: string): string =>
  String(value || '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Untitled Page';

const normalizeCategory = (value: unknown): CampaignCategory => {
  const category = String(value ?? '').trim() as CampaignCategory;
  const allowed: CampaignCategory[] = [
    'business_main_page',
    'discount_offer',
    'festival_offer',
    'product_promotion',
    'service_promotion',
    'event_promotion',
    'limited_time_offer',
    'other'
  ];

  return allowed.includes(category) ? category : 'other';
};

const addYears = (source: Date, years: number): Date => {
  const result = new Date(source);
  result.setFullYear(result.getFullYear() + years);
  return result;
};

const defaultEndAt = (category: CampaignCategory, startDate: Date): Date =>
  addYears(startDate, category === 'business_main_page' ? 10 : 1);

const effectiveEndAt = (category: CampaignCategory, requestedEndAt: unknown, startDate: Date): Date =>
  toDateOrNull(requestedEndAt) || defaultEndAt(category, startDate);

const buildSlugData = (businessSlug: string, pageSlug: string) => {
  const cleanBusinessSlug = normalizeSlug(businessSlug);
  const cleanPageSlug = normalizeSlug(pageSlug);
  const publicSlug = `${cleanBusinessSlug}/${cleanPageSlug}`;
  const fullSlug = `${PUBLIC_DOMAIN}/${publicSlug}`;

  return {
    businessSlug: cleanBusinessSlug,
    pageSlug: cleanPageSlug,
    publicSlug,
    fullSlug
  };
};

const maybeBackfillSlugs = async (item: any): Promise<any> => {
  if (!item) return item;

  const next = buildSlugData(item.businessSlug, item.pageSlug);
  const shouldUpdate = item.publicSlug !== next.publicSlug || item.fullSlug !== next.fullSlug;

  item.businessSlug = next.businessSlug;
  item.pageSlug = next.pageSlug;
  item.publicSlug = next.publicSlug;
  item.fullSlug = next.fullSlug;

  if (shouldUpdate && item._id) {
    await Campaign.updateOne(
      { _id: item._id },
      {
        $set: {
          businessSlug: next.businessSlug,
          pageSlug: next.pageSlug,
          publicSlug: next.publicSlug,
          fullSlug: next.fullSlug
        }
      }
    );
  }

  return item;
};

async function syncLifecycle(item: any): Promise<any> {
  if (!item) return item;

  const now = new Date();
  let changed = false;

  if (item.status === 'scheduled' && item.publishAt && new Date(item.publishAt).getTime() <= now.getTime()) {
    item.status = 'published';
    item.publishedAt = item.publishedAt || now;
    changed = true;
  }

  if (item.status === 'published' && item.endAt && new Date(item.endAt).getTime() <= now.getTime()) {
    item.status = 'expired';
    changed = true;
  }

  if (changed && item._id) {
    await Campaign.updateOne(
      { _id: item._id },
      {
        $set: {
          status: item.status,
          publishedAt: item.publishedAt ?? null
        }
      }
    );
  }

  return item;
}

const serializeCampaign = async (item: any) => {
  await maybeBackfillSlugs(item);
  await syncLifecycle(item);
  return serializeDocument(item);
};

router.get('/public/:businessSlug/:pageSlug', async (req, res, next) => {
  try {
    const businessSlug = normalizeSlug(req.params.businessSlug);
    const pageSlug = normalizeSlug(req.params.pageSlug);

    const item = await Campaign.findOne({
      businessSlug,
      pageSlug
    }).lean();

    if (!item) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    await maybeBackfillSlugs(item as any);
    await syncLifecycle(item as any);

    if ((item as any).status !== 'published') {
      return res.status(404).json({
        message:
          (item as any).status === 'expired'
            ? 'This campaign is no longer available.'
            : 'Campaign is not currently published.'
      });
    }

    return res.json(serializeDocument(item as any));
  } catch (error) {
    return next(error);
  }
});

router.post('/public/:businessSlug/:pageSlug/interactions', async (req, res, next) => {
  try {
    const campaign = await Campaign.findOne({
      businessSlug: normalizeSlug(req.params.businessSlug),
      pageSlug: normalizeSlug(req.params.pageSlug),
      status: 'published'
    }).select('_id businessId');

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    await Interaction.create({
      businessId: (campaign as any).businessId,
      campaignId: (campaign as any)._id,
      event: req.body?.event || 'PAGE_VIEW',
      source: req.body?.source,
      metadata: req.body?.metadata
    });

    return res.status(202).json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get('/context', requireAuth, async (req, res, next) => {
  try {
    if (!req.auth!.businessId) {
      return res.status(400).json({ message: 'No business is linked to this account.' });
    }

    const business = await Business.findById(req.auth!.businessId).lean();

    if (!business) {
      return res.status(404).json({ message: 'Business not found.' });
    }

    return res.json({
      businessId: String((business as any)._id),
      businessName: String((business as any).name ?? ''),
      businessSlug: normalizeSlug((business as any).slug)
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const filter = req.auth!.role === 'admin' ? {} : { businessId: req.auth!.businessId };

    const items = await Campaign.find(filter).sort({ updatedAt: -1 }).lean();
    const serialized = [];

    for (const item of items) {
      serialized.push(await serializeCampaign(item as any));
    }

    return res.json(serialized);
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const filter: any = { _id: req.params.id };

    if (req.auth!.role !== 'admin') {
      filter.businessId = req.auth!.businessId;
    }

    const item = await Campaign.findOne(filter).lean();

    if (!item) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    return res.json(await serializeCampaign(item as any));
  } catch (error) {
    return next(error);
  }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    if (!req.auth!.businessId) {
      return res.status(400).json({ message: 'No business is linked to this account.' });
    }

    const pageSlug = normalizeSlug(req.body?.pageSlug);
    const providedName = String(req.body?.name ?? '').trim();
    const name = providedName || toTitleFromSlug(pageSlug);
    const category = normalizeCategory(req.body?.category);
    const description = String(req.body?.description ?? '').trim();
    const templateId = String(req.body?.templateId ?? '').trim();
    const useBlankTemplate = Boolean(req.body?.useBlankTemplate) || templateId === BLANK_TEMPLATE_ID;

    if (!pageSlug) {
      return res.status(400).json({ message: 'Campaign page slug is required.' });
    }

    if (!templateId) {
      return res.status(400).json({ message: 'Template selection is required.' });
    }

    const business = await Business.findById(req.auth!.businessId).lean();

    if (!business) {
      return res.status(404).json({ message: 'Business not found.' });
    }

    const slugData = buildSlugData((business as any).slug, pageSlug);

    const duplicate = await Campaign.exists({
      businessId: req.auth!.businessId,
      publicSlug: slugData.publicSlug
    });

    if (duplicate) {
      return res.status(409).json({ message: 'This page slug is already used in your business page.' });
    }

    let campaignTemplateId = templateId;
    let campaignTemplateName = '';
    let html = '';
    let design: any = null;

    if (useBlankTemplate) {
      campaignTemplateId = BLANK_TEMPLATE_ID;
      campaignTemplateName = '<blank>';
      html = '';
      design = null;
    } else {
      const template = await Template.findOne({
        _id: templateId,
        accountId: req.auth!.accountId
      }).lean();

      if (!template) {
        return res.status(404).json({ message: 'Template not found.' });
      }

      campaignTemplateId = String((template as any)._id);
      campaignTemplateName = String((template as any).name ?? '');
      html = String((template as any).html ?? '');
      design = (template as any).design ?? null;
    }

    const cycleStartedAt = new Date();
    const endAt = effectiveEndAt(category, req.body?.endAt, cycleStartedAt);

    const item = await Campaign.create({
      businessId: req.auth!.businessId,
      businessSlug: slugData.businessSlug,
      publicSlug: slugData.publicSlug,
      fullSlug: slugData.fullSlug,
      name,
      pageSlug: slugData.pageSlug,
      category,
      templateId: campaignTemplateId,
      templateName: campaignTemplateName,
      html,
      design,
      description,
      status: 'draft',
      publishAt: null,
      endAt,
      publishedAt: null,
      cycleNumber: 1,
      cycleStartedAt,
      cycles: []
    });

    return res.status(201).json(serializeDocument(item.toObject() as any));
  } catch (error) {
    return next(error);
  }
});

router.put('/:id', requireAuth, async (req, res, next) => {
  try {
    const filter: any = { _id: req.params.id };

    if (req.auth!.role !== 'admin') {
      filter.businessId = req.auth!.businessId;
    }

    const existing = await Campaign.findOne(filter);

    if (!existing) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    const update: Record<string, unknown> = {};
    const nextCategory = req.body?.category !== undefined ? normalizeCategory(req.body.category) : existing.category;

    if (typeof req.body?.name === 'string') {
      const name = req.body.name.trim();
      update['name'] = name || existing.name || toTitleFromSlug(existing.pageSlug);
    }

    if (req.body?.category !== undefined) {
      update['category'] = nextCategory;
    }

    if (typeof req.body?.description === 'string') {
      update['description'] = req.body.description.trim();
    }

    if (typeof req.body?.html === 'string') {
      update['html'] = req.body.html;
    }

    if (req.body?.design !== undefined) {
      update['design'] = req.body.design;
    }

    if (req.body?.endAt !== undefined || req.body?.category !== undefined) {
      const baseDate = (existing as any).cycleStartedAt || (existing as any).createdAt || new Date();
      update['endAt'] = effectiveEndAt(nextCategory, req.body?.endAt, baseDate);
    }

    const item = await Campaign.findOneAndUpdate(filter, { $set: update }, { new: true, runValidators: true }).lean();
    return res.json(await serializeCampaign(item as any));
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/publish', requireAuth, async (req, res, next) => {
  try {
    const filter: any = { _id: req.params.id };

    if (req.auth!.role !== 'admin') {
      filter.businessId = req.auth!.businessId;
    }

    const existing = await Campaign.findOne(filter);

    if (!existing) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    const now = new Date();
    const endAt = req.body?.endAt
      ? toDateOrNull(req.body.endAt)
      : existing.endAt || defaultEndAt(existing.category as CampaignCategory, (existing as any).cycleStartedAt || now);

    if (!endAt || endAt.getTime() <= now.getTime()) {
      return res.status(400).json({ message: 'Campaign end date must be in the future.' });
    }

    existing.status = 'published';
    existing.publishAt = now;
    existing.publishedAt = now;
    existing.endAt = endAt;

    await existing.save();
    return res.json(await serializeCampaign(existing.toObject() as any));
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/schedule', requireAuth, async (req, res, next) => {
  try {
    const filter: any = { _id: req.params.id };

    if (req.auth!.role !== 'admin') {
      filter.businessId = req.auth!.businessId;
    }

    const existing = await Campaign.findOne(filter);

    if (!existing) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    const publishAt = toDateOrNull(req.body?.publishAt);
    const now = new Date();

    if (!publishAt || publishAt.getTime() <= now.getTime()) {
      return res.status(400).json({ message: 'Schedule date must be in the future.' });
    }

    const endAt = req.body?.endAt
      ? toDateOrNull(req.body.endAt)
      : existing.endAt || defaultEndAt(existing.category as CampaignCategory, (existing as any).cycleStartedAt || now);

    if (!endAt || endAt.getTime() <= publishAt.getTime()) {
      return res.status(400).json({ message: 'Campaign end date must be after publish date.' });
    }

    existing.status = 'scheduled';
    existing.publishAt = publishAt;
    existing.endAt = endAt;
    existing.publishedAt = null;

    await existing.save();
    return res.json(await serializeCampaign(existing.toObject() as any));
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/unpublish', requireAuth, async (req, res, next) => {
  try {
    const filter: any = { _id: req.params.id };

    if (req.auth!.role !== 'admin') {
      filter.businessId = req.auth!.businessId;
    }

    const item = await Campaign.findOneAndUpdate(
      filter,
      {
        $set: {
          status: 'unpublished'
        }
      },
      { new: true, runValidators: true }
    ).lean();

    if (!item) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    return res.json(await serializeCampaign(item as any));
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/reuse', requireAuth, async (req, res, next) => {
  try {
    const filter: any = { _id: req.params.id };

    if (req.auth!.role !== 'admin') {
      filter.businessId = req.auth!.businessId;
    }

    const existing = await Campaign.findOne(filter);

    if (!existing) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    const now = new Date();

    existing.cycles = existing.cycles || [];
    existing.cycles.push({
      cycleNumber: existing.cycleNumber || 1,
      startedAt: (existing as any).cycleStartedAt || (existing as any).createdAt || now,
      endedAt: now,
      status: existing.status as CampaignStatus,
      publishAt: existing.publishAt || null,
      endAt: existing.endAt || null,
      publishedAt: existing.publishedAt || null
    });

    existing.cycleNumber = (existing.cycleNumber || 1) + 1;
    existing.cycleStartedAt = now;
    existing.status = 'draft';
    existing.publishAt = null;
    existing.publishedAt = null;
    existing.endAt = defaultEndAt(existing.category as CampaignCategory, now);

    await existing.save();
    return res.json(await serializeCampaign(existing.toObject() as any));
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const filter: any = { _id: req.params.id };

    if (req.auth!.role !== 'admin') {
      filter.businessId = req.auth!.businessId;
    }

    const item = await Campaign.findOneAndDelete(filter);

    if (!item) {
      return res.status(404).json({ message: 'Campaign not found.' });
    }

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;

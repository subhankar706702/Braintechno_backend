import { Router } from 'express';
import mongoose from 'mongoose';

import { requireAuth } from '../middleware/auth.js';
import { Broadcast, BROADCAST_CHANNELS, BROADCAST_SEND_MODES } from '../models/broadcast.model.js';
import { User } from '../models/user.model.js';
import { Campaign } from '../models/campaign.model.js';
import {
  getBroadcastAudienceStats,
  type BroadcastRecipientChannel
} from '../services/broadcast-recipient.service.js';

const router = Router();

const cleanText = (value: unknown): string => String(value ?? '').trim();

const publicBroadcast = (item: any) => ({
  id: String(item._id),
  name: cleanText(item.name),
  message: cleanText(item.message),
  campaignId: item.campaignId ? String(item.campaignId) : '',
  campaignName: cleanText(item.campaignName),
  campaignSlug: cleanText(item.campaignSlug),
  audience: {
    customerType: cleanText(item.audience?.customerType) || 'All',
    sources: Array.isArray(item.audience?.sources) ? item.audience.sources : [],
    city: cleanText(item.audience?.city),
    lastContact: cleanText(item.audience?.lastContact) || 'any'
  },
  matchedAudienceCount: Number(item.matchedAudienceCount ?? item.recipientCount ?? 0),
  recipientCount: Number(item.recipientCount ?? 0),
  excludedRecipientCount: Number(item.excludedRecipientCount ?? 0),
  channelRecipientCounts: {
    WhatsApp: Number(item.channelRecipientCounts?.WhatsApp ?? 0),
    SMS: Number(item.channelRecipientCounts?.SMS ?? 0),
    Email: Number(item.channelRecipientCounts?.Email ?? 0)
  },
  channels: Array.isArray(item.channels) ? item.channels : [],
  sendMode: item.sendMode,
  scheduledAt: item.scheduledAt ?? null,
  status: item.status,
  sentCount: Number(item.sentCount ?? 0),
  deliveredCount: Number(item.deliveredCount ?? 0),
  failedCount: Number(item.failedCount ?? 0),
  createdAt: item.createdAt,
  updatedAt: item.updatedAt
});

function businessFilter(req: any): Record<string, unknown> {
  if (req.auth?.role === 'admin') {
    const businessId = cleanText(req.query?.businessId);
    return businessId ? { businessId } : {};
  }

  return { businessId: req.auth?.businessId };
}

async function resolveAccountId(businessId: string): Promise<string> {
  const user = await User.findOne({ businessId }).select('accountId').lean();
  const accountId = cleanText(user?.accountId);

  if (!accountId) {
    throw Object.assign(new Error('Business account is not configured.'), { status: 409 });
  }

  return accountId;
}


router.use(requireAuth);

router.get('/summary', async (req, res, next) => {
  try {
    const filter = businessFilter(req);
    const [total, scheduled, sent, drafts] = await Promise.all([
      Broadcast.countDocuments(filter),
      Broadcast.countDocuments({ ...filter, status: 'Scheduled' }),
      Broadcast.countDocuments({ ...filter, status: 'Sent' }),
      Broadcast.countDocuments({ ...filter, status: 'Draft' })
    ]);

    return res.json({ total, scheduled, sent, drafts });
  } catch (error) {
    return next(error);
  }
});

router.get('/options', async (req, res, next) => {
  try {
    const filter = businessFilter(req);
    const businessId = cleanText((filter as any).businessId);

    const campaigns = businessId
      ? await Campaign.find({ businessId, status: 'published' })
          .select('_id name pageSlug businessSlug status')
          .sort({ createdAt: -1 })
          .limit(100)
          .lean()
      : [];

    return res.json({
      campaigns: campaigns.map((item: any) => ({
        id: String(item._id),
        name: cleanText(item.name),
        pageSlug: cleanText(item.pageSlug),
        businessSlug: cleanText(item.businessSlug),
        status: cleanText(item.status),
        url: `https://www.braintechno.com/${cleanText(item.businessSlug)}/${cleanText(item.pageSlug)}`
      })),
      sources: ['Facebook', 'WhatsApp', 'Manual', 'Excel', 'AI', 'Instagram', 'Direct', 'Campaign']
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/audience-count', async (req, res, next) => {
  try {
    const filter = businessFilter(req);
    const businessId = cleanText((filter as any).businessId);
    const accountId = await resolveAccountId(businessId);
    const channels = Array.isArray(req.body?.channels)
      ? req.body.channels.filter((item: unknown): item is BroadcastRecipientChannel =>
          item === 'WhatsApp' || item === 'SMS' || item === 'Email'
        )
      : [];

    const stats = await getBroadcastAudienceStats(
      accountId,
      businessId,
      req.body?.audience,
      channels.length ? channels : ['WhatsApp']
    );

    return res.json({ count: stats.recipientCount, ...stats });
  } catch (error: any) {
    if (error?.status) {
      return res.status(error.status).json({ message: error.message });
    }
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const filter: any = businessFilter(req);
    const search = cleanText(req.query?.search);
    const page = Math.max(1, Number(req.query?.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit) || 20));

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      filter.$or = [
        { name: rx },
        { message: rx },
        { campaignName: rx }
      ];
    }

    const [total, items] = await Promise.all([
      Broadcast.countDocuments(filter),
      Broadcast.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return res.json({
      items: items.map(publicBroadcast),
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid broadcast id.' });
    }

    const item = await Broadcast.findOne({
      _id: req.params.id,
      ...businessFilter(req)
    }).lean();

    if (!item) {
      return res.status(404).json({ message: 'Broadcast not found.' });
    }

    return res.json(publicBroadcast(item));
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const filter = businessFilter(req);
    const businessId = cleanText((filter as any).businessId);
    const accountId = await resolveAccountId(businessId);

    const name = cleanText(req.body?.name);
    const message = cleanText(req.body?.message);
    const audience = req.body?.audience ?? {};
    const channels = Array.isArray(req.body?.channels)
      ? req.body.channels.filter((item: unknown) => (BROADCAST_CHANNELS as readonly unknown[]).includes(item))
      : [];
    const sendMode = cleanText(req.body?.sendMode) as typeof BROADCAST_SEND_MODES[number];

    if (!name) return res.status(400).json({ message: 'Broadcast name is required.' });
    if (!message) return res.status(400).json({ message: 'Message is required.' });
    if (message.length > 2000) return res.status(400).json({ message: 'Message cannot exceed 2000 characters.' });
    if (!channels.length) return res.status(400).json({ message: 'Select at least one channel.' });
    if (!(BROADCAST_SEND_MODES as readonly string[]).includes(sendMode)) {
      return res.status(400).json({ message: 'Invalid send mode.' });
    }

    let scheduledAt: Date | null = null;
    if (sendMode === 'schedule') {
      const parsed = new Date(req.body?.scheduledAt);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ message: 'A valid schedule date and time are required.' });
      }
      if (parsed.getTime() <= Date.now()) {
        return res.status(400).json({ message: 'Schedule time must be in the future.' });
      }
      scheduledAt = parsed;
    }

    const stats = await getBroadcastAudienceStats(
      accountId,
      businessId,
      audience,
      channels as BroadcastRecipientChannel[]
    );

    let campaignName = '';
    let campaignSlug = '';
    let campaignId: mongoose.Types.ObjectId | null = null;

    const requestedCampaignId = cleanText(req.body?.campaignId);
    if (requestedCampaignId && mongoose.isValidObjectId(requestedCampaignId)) {
      const campaign = await Campaign.findOne({
        _id: requestedCampaignId,
        businessId
      }).select('_id name pageSlug businessSlug').lean();

      if (campaign) {
        campaignId = campaign._id;
        campaignName = cleanText(campaign.name);
        campaignSlug = cleanText(campaign.pageSlug);
      }
    }

    // Delivery is intentionally not triggered here. The stored recipient counts are
    // eligibility-aware; the eventual send worker must re-run the same contact
    // eligibility check immediately before sending to skip customers who no
    // longer have the required mobile/email contact field.
    const status = sendMode === 'schedule' ? 'Scheduled' : 'Draft';

    const created = await Broadcast.create({
      accountId,
      businessId,
      name,
      message,
      campaignId,
      campaignName,
      campaignSlug,
      audience: {
        customerType: cleanText(audience.customerType) || 'All',
        sources: Array.isArray(audience.sources) ? audience.sources.map(cleanText).filter(Boolean) : [],
        city: cleanText(audience.city),
        lastContact: cleanText(audience.lastContact) || 'any'
      },
      matchedAudienceCount: stats.matchedCount,
      recipientCount: stats.recipientCount,
      excludedRecipientCount: stats.excludedCount,
      channelRecipientCounts: stats.byChannel,
      channels,
      sendMode,
      scheduledAt,
      status
    });

    return res.status(201).json(publicBroadcast(created.toObject()));
  } catch (error: any) {
    if (error?.status) {
      return res.status(error.status).json({ message: error.message });
    }
    return next(error);
  }
});

router.patch('/:id/cancel', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid broadcast id.' });
    }

    const item = await Broadcast.findOneAndUpdate(
      { _id: req.params.id, ...businessFilter(req), status: 'Scheduled' },
      { $set: { status: 'Cancelled' } },
      { new: true, runValidators: true }
    ).lean();

    if (!item) {
      return res.status(404).json({ message: 'Scheduled broadcast not found.' });
    }

    return res.json(publicBroadcast(item));
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid broadcast id.' });
    }

    const deleted = await Broadcast.findOneAndDelete({
      _id: req.params.id,
      ...businessFilter(req)
    });

    if (!deleted) {
      return res.status(404).json({ message: 'Broadcast not found.' });
    }

    return res.json({ message: 'Broadcast deleted successfully.' });
  } catch (error) {
    return next(error);
  }
});

export default router;

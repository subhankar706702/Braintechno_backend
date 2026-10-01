import { Router } from 'express';
import mongoose from 'mongoose';

import { requireAuth } from '../middleware/auth.js';
import { Campaign } from '../models/campaign.model.js';
import { Customer } from '../models/customer.model.js';
import { Message, MESSAGE_QUERY_STATUS } from '../models/message.model.js';
import { User } from '../models/user.model.js';

const router = Router();

const cleanText = (value: unknown): string => String(value ?? '').trim();

const normalizeSlug = (value: unknown): string =>
  cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizePhone = (value: unknown): string =>
  cleanText(value).replace(/[^0-9+]/g, '');

const normalizeEmail = (value: unknown): string =>
  cleanText(value).toLowerCase();

const publicMessage = (item: any) => ({
  id: String(item._id),
  customerId: String(item.customerId),
  customerName: cleanText(item.customerName),
  customerMobile: cleanText(item.customerMobile),
  customerEmail: cleanText(item.customerEmail),
  message: cleanText(item.message),
  source: item.source,
  campaignId: item.campaignId ? String(item.campaignId) : '',
  campaignName: cleanText(item.campaignName),
  campaignSlug: cleanText(item.campaignSlug),
  readStatus: item.readStatus,
  queryStatus: item.queryStatus,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
});

const publicThread = (item: any) => ({
  customer: {
    id: String(item.customer?._id ?? item.customerId),
    name: cleanText(item.customer?.name ?? item.customerName),
    mobile: cleanText(item.customer?.mobile ?? item.customerMobile),
    email: cleanText(item.customer?.email ?? item.customerEmail),
    image: cleanText(item.customer?.image),
    customerType: item.customer?.customerType ?? 'New',
    lastContactAt: item.customer?.lastContactAt ?? item.createdAt ?? null,
  },
  latestMessage: publicMessage(item.latestMessage ?? item),
  unreadCount: Number(item.unreadCount ?? 0),
  source: item.latestMessage?.source ?? item.source ?? 'Campaign',
  campaign: {
    id: item.latestMessage?.campaignId ? String(item.latestMessage.campaignId) : '',
    name: cleanText(item.latestMessage?.campaignName),
    slug: cleanText(item.latestMessage?.campaignSlug),
  },
});

async function resolveAccountForCampaign(campaign: any): Promise<string> {
  const user = await User.findOne({ businessId: campaign.businessId })
    .select('accountId')
    .lean();

  const accountId = cleanText(user?.accountId);

  if (!accountId) {
    throw Object.assign(new Error('Business account is not configured.'), { status: 409 });
  }

  return accountId;
}

/*
 * POST /api/messages/public/:businessSlug/:pageSlug
 *
 * Public customer -> business message endpoint.
 * No login is required.
 */
router.post('/public/:businessSlug/:pageSlug', async (req, res, next) => {
  try {
    const businessSlug = normalizeSlug(req.params.businessSlug);
    const pageSlug = normalizeSlug(req.params.pageSlug);

    const name = cleanText(req.body?.name);
    const mobile = normalizePhone(req.body?.mobile);
    const email = normalizeEmail(req.body?.email);
    const messageText = cleanText(req.body?.message);

    if (!businessSlug || !pageSlug) {
      return res.status(400).json({ message: 'Campaign URL is required.' });
    }

    if (!name) {
      return res.status(400).json({ message: 'Customer name is required.' });
    }

    if (!mobile) {
      return res.status(400).json({ message: 'Customer mobile number is required.' });
    }

    if (!messageText) {
      return res.status(400).json({ message: 'Message is required.' });
    }

    if (messageText.length > 2000) {
      return res.status(400).json({ message: 'Message cannot exceed 2000 characters.' });
    }

    const campaign = await Campaign.findOne({
      businessSlug,
      pageSlug,
      status: 'published'
    })
      .select('_id businessId name pageSlug businessSlug status')
      .lean();

    if (!campaign) {
      return res.status(404).json({ message: 'Campaign not found or not published.' });
    }

    const accountId = await resolveAccountForCampaign(campaign);

    let customer = await Customer.findOne({
      accountId,
      mobile
    });

    if (!customer) {
      customer = await Customer.create({
        accountId,
        businessId: campaign.businessId,
        name,
        mobile,
        email,
        customerType: 'New',
        source: 'Campaign',
        lastContactAt: new Date()
      });
    } else {
      const customerPatch: Record<string, unknown> = {
        lastContactAt: new Date()
      };

      if (name) customerPatch.name = name;
      if (email) customerPatch.email = email;

      customer = await Customer.findOneAndUpdate(
        { _id: customer._id, accountId },
        { $set: customerPatch },
        { new: true, runValidators: true }
      );
    }

    if (!customer) {
      return res.status(500).json({ message: 'Could not save customer.' });
    }

    const created = await Message.create({
      accountId,
      businessId: campaign.businessId,
      customerId: customer._id,
      campaignId: campaign._id,
      campaignName: campaign.name,
      campaignSlug: campaign.pageSlug,
      source: 'Campaign',
      customerName: name,
      customerMobile: mobile,
      customerEmail: email,
      message: messageText,
      readStatus: 'unread',
      queryStatus: 'New'
    });

    return res.status(201).json({
      message: 'Message received successfully.',
      item: publicMessage(created.toObject())
    });
  } catch (error: any) {
    if (error?.status) {
      return res.status(error.status).json({ message: error.message });
    }

    return next(error);
  }
});

/* Everything below this point is owner/admin dashboard access. */
router.use(requireAuth);

function buildBusinessFilter(req: any): Record<string, unknown> {
  if (req.auth?.role === 'admin') {
    const requestedBusinessId = cleanText(req.query?.businessId);
    return requestedBusinessId ? { businessId: requestedBusinessId } : {};
  }

  return { businessId: req.auth?.businessId };
}

router.get('/summary', async (req, res, next) => {
  try {
    const filter = buildBusinessFilter(req);

    const [total, unread, read] = await Promise.all([
      Message.countDocuments(filter),
      Message.countDocuments({ ...filter, readStatus: 'unread' }),
      Message.countDocuments({ ...filter, readStatus: 'read' })
    ]);

    return res.json({ total, unread, read });
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const filter: any = buildBusinessFilter(req);
    const tab = cleanText(req.query?.tab).toLowerCase();
    const search = cleanText(req.query?.search);
    const page = Math.max(1, Number(req.query?.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit) || 20));

    if (tab === 'unread') filter.readStatus = 'unread';
    if (tab === 'read') filter.readStatus = 'read';

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      filter.$or = [
        { customerName: rx },
        { customerMobile: rx },
        { message: rx },
        { campaignName: rx }
      ];
    }

    const total = await Message.countDocuments(filter);

    const latestMessages = await Message.aggregate([
      { $match: filter },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$customerId',
          latestMessage: { $first: '$$ROOT' },
          unreadCount: {
            $sum: { $cond: [{ $eq: ['$readStatus', 'unread'] }, 1, 0] }
          }
        }
      },
      { $sort: { 'latestMessage.createdAt': -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit }
    ]);

    const customerIds = latestMessages.map(item => item._id);
    const customers = await Customer.find({
      ...('businessId' in filter ? { businessId: filter.businessId } : {}),
      _id: { $in: customerIds }
    }).lean();

    const customerMap = new Map(
      customers.map(item => [String(item._id), item])
    );

    const items = latestMessages.map(item =>
      publicThread({
        ...item,
        customer: customerMap.get(String(item._id)),
      })
    );

    return res.json({
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/customer/:customerId', async (req, res, next) => {
  try {
    const filter: any = buildBusinessFilter(req);
    const customerId = req.params.customerId;

    if (!mongoose.isValidObjectId(customerId)) {
      return res.status(400).json({ message: 'Invalid customer ID.' });
    }

    const messages = await Message.find({
      ...filter,
      customerId
    }).sort({ createdAt: 1 }).lean();

    const customer = await Customer.findOne({
      ...filter,
      _id: customerId
    }).lean();

    if (!customer && messages.length === 0) {
      return res.status(404).json({ message: 'Message thread not found.' });
    }

    return res.json({
      customer: customer
        ? {
            id: String(customer._id),
            name: cleanText(customer.name),
            mobile: cleanText(customer.mobile),
            email: cleanText(customer.email),
            image: cleanText(customer.image),
            customerType: customer.customerType,
            lastContactAt: customer.lastContactAt ?? null
          }
        : null,
      messages: messages.map(publicMessage)
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/read', async (req, res, next) => {
  try {
    const filter: any = buildBusinessFilter(req);

    const item = await Message.findOneAndUpdate(
      { ...filter, _id: req.params.id },
      { $set: { readStatus: 'read', readAt: new Date() } },
      { new: true }
    ).lean();

    if (!item) {
      return res.status(404).json({ message: 'Message not found.' });
    }

    return res.json(publicMessage(item));
  } catch (error) {
    return next(error);
  }
});

router.patch('/customer/:customerId/read', async (req, res, next) => {
  try {
    const filter: any = buildBusinessFilter(req);

    await Message.updateMany(
      { ...filter, customerId: req.params.customerId, readStatus: 'unread' },
      { $set: { readStatus: 'read', readAt: new Date() } }
    );

    return res.json({ message: 'Conversation marked as read.' });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const filter: any = buildBusinessFilter(req);
    const queryStatus = cleanText(req.body?.queryStatus);

    if (!(MESSAGE_QUERY_STATUS as readonly string[]).includes(queryStatus)) {
      return res.status(400).json({
        message: 'Invalid query status.'
      });
    }

    const item = await Message.findOneAndUpdate(
      { ...filter, _id: req.params.id },
      { $set: { queryStatus } },
      { new: true, runValidators: true }
    ).lean();

    if (!item) {
      return res.status(404).json({ message: 'Message not found.' });
    }

    return res.json(publicMessage(item));
  } catch (error) {
    return next(error);
  }
});

export default router;

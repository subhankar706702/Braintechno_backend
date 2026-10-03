import { Router } from 'express';
import mongoose from 'mongoose';

import { requireAuth } from '../middleware/auth.js';
import { Campaign } from '../models/campaign.model.js';
import {
  Customer,
  CUSTOMER_SOURCES,
  CUSTOMER_TYPES
} from '../models/customer.model.js';
import { Message } from '../models/message.model.js';
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

const normalizePhoneKey = (value: unknown): string =>
  normalizePhone(value).replace(/\D/g, '');

const normalizeEmail = (value: unknown): string =>
  cleanText(value).toLowerCase();

const isCustomerType = (value: string): boolean =>
  (CUSTOMER_TYPES as readonly string[]).includes(value);

const isCustomerSource = (value: string): boolean =>
  (CUSTOMER_SOURCES as readonly string[]).includes(value);

const CAMPAIGN_SOURCE =
  CUSTOMER_SOURCES.find(source => source === 'Campaign') ??
  CUSTOMER_SOURCES[0] ??
  '';

const publicCustomer = (item: any) => ({
  id: String(item._id),
  accountId: cleanText(item.accountId),
  name: cleanText(item.name),
  mobile: cleanText(item.mobile),
  email: cleanText(item.email),
  customerType: cleanText(item.customerType),
  source: cleanText(item.source),
  image: cleanText(item.image),
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
  lastContactAt: item.lastContactAt ?? null,
});

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

async function resolveAccountForCampaign(campaign: any): Promise<string> {
  const user = await User.findOne({ businessId: campaign.businessId })
    .select('accountId')
    .lean();

  const accountId = cleanText(user?.accountId);

  if (!accountId) {
    throw Object.assign(
      new Error('Business account is not configured.'),
      { status: 409 }
    );
  }

  return accountId;
}
/*
 * POST /api/customers/public/:businessSlug/:pageSlug
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
      return res.status(400).json({
        message: 'Campaign URL is required.'
      });
    }

    if (!name) {
      return res.status(400).json({
        message: 'Customer name is required.'
      });
    }

    if (!mobile) {
      return res.status(400).json({
        message: 'Customer mobile number is required.'
      });
    }

    if (!messageText) {
      return res.status(400).json({
        message: 'Message is required.'
      });
    }

    if (messageText.length > 2000) {
      return res.status(400).json({
        message: 'Message cannot exceed 2000 characters.'
      });
    }

    const campaign = await Campaign.findOne({
      businessSlug,
      pageSlug,
      status: 'published'
    })
      .select('_id businessId name pageSlug businessSlug status')
      .lean();

    if (!campaign) {
      return res.status(404).json({
        message: 'Campaign not found or not published.'
      });
    }

    const accountId = await resolveAccountForCampaign(campaign);
    const mobileNormalized = normalizePhoneKey(mobile);

    let customer = await Customer.findOne({
      accountId,
      mobileNormalized
    });

    if (!customer) {
      /*
       * Customer model accepts the backend-defined customer
       * type/source values.
       */
      const customerType =
        (CUSTOMER_TYPES[0] ?? '') as (typeof CUSTOMER_TYPES)[number];

      const source =
        (CAMPAIGN_SOURCE || CUSTOMER_SOURCES[0] || '') as
        (typeof CUSTOMER_SOURCES)[number];

      customer = new Customer({
        accountId,
        businessId: campaign.businessId,
        name,
        mobile,
        mobileNormalized,
        email,
        emailNormalized: email,
        customerType,
        source,
        lastContactAt: new Date()
      });

      await customer.save();
    } else {
      const customerPatch: Record<string, unknown> = {
        lastContactAt: new Date()
      };

      if (name) {
        customerPatch.name = name;
      }

      if (email) {
        customerPatch.email = email;
        customerPatch.emailNormalized = email;
      }

      customer = await Customer.findOneAndUpdate(
        {
          _id: customer._id,
          accountId
        },
        {
          $set: customerPatch
        },
        {
          new: true,
          runValidators: true
        }
      );
    }

    if (!customer) {
      return res.status(500).json({
        message: 'Could not save customer.'
      });
    }

    /*
     * Message.source is intentionally fixed to the Message model's
     * supported Campaign source.
     */
    const messageSource = 'Campaign' as const;

    const created = new Message({
      accountId,
      businessId: campaign.businessId,
      customerId: customer._id,
      campaignId: campaign._id,
      campaignName: campaign.name,
      campaignSlug: campaign.pageSlug,
      source: messageSource,
      customerName: name,
      customerMobile: mobile,
      customerEmail: email,
      message: messageText,
      readStatus: 'unread',
      queryStatus: 'New'
    });

    await created.save();

    return res.status(201).json({
      message: 'Message received successfully.',
      item: publicMessage(created.toObject())
    });
  } catch (error: any) {
    if (error?.status) {
      return res.status(error.status).json({
        message: error.message
      });
    }

    return next(error);
  }
});

router.use(requireAuth);

function requestedAccountId(req: any): string {
  if (req.auth?.role === 'admin') {
    return cleanText(
      req.query?.accountId ??
      req.body?.accountId
    );
  }

  return cleanText(req.auth?.accountId);
}

async function buildCustomerCounts(
  filter: Record<string, unknown>
) {
  const total = await Customer.countDocuments(filter);

  const entries = await Promise.all(
    CUSTOMER_TYPES.map(async type => [
      type,
      await Customer.countDocuments({
        ...filter,
        customerType: type
      })
    ] as const)
  );

  return {
    total,
    byType: Object.fromEntries(entries)
  };
}

/*
 * GET /api/customers/options
 * Backend is the only source of customer type/source values.
 */
router.get('/options', (_req, res) => {
  return res.json({
    customerTypes: [...CUSTOMER_TYPES],
    customerSources: [...CUSTOMER_SOURCES]
  });
});

/*
 * GET /api/customers
 */
router.get('/', async (req, res, next) => {
  try {
    const accountId = requestedAccountId(req);

    if (!accountId) {
      return res.status(400).json({
        message: 'Account ID is required.'
      });
    }

    const filter: Record<string, unknown> = {
      accountId
    };

    const search = cleanText(req.query?.search);
    const type = cleanText(req.query?.type);
    const source = cleanText(req.query?.source);
    const sort = cleanText(req.query?.sort) || 'newest';
    const page = Math.max(1, Number(req.query?.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit) || 20));

    if (type) {
      if (!isCustomerType(type)) {
        return res.status(400).json({ message: 'Invalid customer type.' });
      }
      filter.customerType = type;
    }

    if (source) {
      if (!isCustomerSource(source)) {
        return res.status(400).json({ message: 'Invalid customer source.' });
      }
      filter.source = source;
    }

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      filter.$or = [
        { name: rx },
        { mobile: rx },
        { email: rx }
      ];
    }

    const sortMap: Record<string, Record<string, 1 | -1>> = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      name_asc: { name: 1, createdAt: -1 },
      name_desc: { name: -1, createdAt: -1 }
    };

    const sortValue = sortMap[sort] ?? sortMap.newest;

    const [items, total, counts] = await Promise.all([
      Customer.find(filter)
        .sort(sortValue)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Customer.countDocuments(filter),
      buildCustomerCounts({ accountId })
    ]);

    const totalPages = Math.ceil(total / limit);

    return res.json({
      items: items.map(publicCustomer),
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasMore: page * limit < total
      },
      counts
    });
  } catch (error) {
    return next(error);
  }
});

/*
 * POST /api/customers
 */
router.post('/', async (req, res, next) => {
  try {
    const accountId = requestedAccountId(req);

    if (!accountId) {
      return res.status(400).json({
        message: 'Account ID is required.'
      });
    }

    const name = cleanText(req.body?.name);
    const mobile = normalizePhone(req.body?.mobile);
    const email = normalizeEmail(req.body?.email);
    const image = cleanText(req.body?.image);

    const customerTypeValue =
      cleanText(req.body?.customerType) || CUSTOMER_TYPES[0] || '';

    const sourceValue =
      cleanText(req.body?.source) || CUSTOMER_SOURCES[0] || '';

    if (!name && !mobile && !email) {
      return res.status(400).json({
        message: 'Enter at least a name, mobile number or email.'
      });
    }

    if (!isCustomerType(customerTypeValue)) {
      return res.status(400).json({
        message: 'Invalid customer type.'
      });
    }

    if (!isCustomerSource(sourceValue)) {
      return res.status(400).json({
        message: 'Invalid customer source.'
      });
    }

    /*
     * After runtime validation, tell TypeScript that these values
     * belong to the backend-defined customer type/source arrays.
     */
    const customerType =
      customerTypeValue as (typeof CUSTOMER_TYPES)[number];

    const source =
      sourceValue as (typeof CUSTOMER_SOURCES)[number];

    const mobileNormalized = normalizePhoneKey(mobile);
    const emailNormalized = normalizeEmail(email);

    const duplicateOr: Record<string, unknown>[] = [];

    if (mobileNormalized) {
      duplicateOr.push({
        mobileNormalized
      });
    }

    if (emailNormalized) {
      duplicateOr.push({
        emailNormalized
      });
    }

    if (duplicateOr.length) {
      const duplicate = await Customer.findOne({
        accountId,
        $or: duplicateOr
      }).lean();

      if (duplicate) {
        if (
          mobileNormalized &&
          duplicate.mobileNormalized === mobileNormalized
        ) {
          return res.status(409).json({
            message: `This mobile number (${mobile}) is already added in your contact list.`
          });
        }

        return res.status(409).json({
          message: `This email (${email}) is already added in your contact list.`
        });
      }
    }

    /*
     * Use new Customer() + save() instead of Customer.create().
     * This avoids the Mongoose create() overload inference issue.
     */
    const customer = new Customer({
      accountId,
      businessId: req.auth?.businessId,
      name,
      mobile,
      mobileNormalized,
      email,
      emailNormalized,
      customerType,
      source,
      image
    });

    await customer.save();

    return res
      .status(201)
      .json(publicCustomer(customer.toObject()));
  } catch (error) {
    return next(error);
  }
});

/*
 * PATCH /api/customers/:id
 */
router.patch('/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid customer ID.' });
    }

    const accountId = requestedAccountId(req);

    if (!accountId) {
      return res.status(400).json({ message: 'Account ID is required.' });
    }

    const patch: Record<string, unknown> = {};

    if (req.body?.name !== undefined) {
      patch.name = cleanText(req.body.name);
    }

    if (req.body?.mobile !== undefined) {
      const mobile = normalizePhone(req.body.mobile);
      patch.mobile = mobile;
      patch.mobileNormalized = normalizePhoneKey(mobile);
    }

    if (req.body?.email !== undefined) {
      const email = normalizeEmail(req.body.email);
      patch.email = email;
      patch.emailNormalized = email;
    }

    if (req.body?.image !== undefined) {
      patch.image = cleanText(req.body.image);
    }

    if (req.body?.customerType !== undefined) {
      const customerType = cleanText(req.body.customerType);

      if (!isCustomerType(customerType)) {
        return res.status(400).json({ message: 'Invalid customer type.' });
      }

      patch.customerType = customerType;
    }

    if (req.body?.source !== undefined) {
      const source = cleanText(req.body.source);

      if (!isCustomerSource(source)) {
        return res.status(400).json({ message: 'Invalid customer source.' });
      }

      patch.source = source;
    }

    if (!Object.keys(patch).length) {
      return res.status(400).json({ message: 'No customer changes supplied.' });
    }

    const duplicateOr = [] as Record<string, unknown>[];

    if (patch.mobileNormalized) {
      duplicateOr.push({ mobileNormalized: patch.mobileNormalized });
    }

    if (patch.emailNormalized) {
      duplicateOr.push({ emailNormalized: patch.emailNormalized });
    }

    if (duplicateOr.length) {
      const duplicate = await Customer.findOne({
        accountId,
        _id: { $ne: req.params.id },
        $or: duplicateOr
      }).lean();

      if (duplicate) {
        if (
          patch.mobileNormalized &&
          duplicate.mobileNormalized === patch.mobileNormalized
        ) {
          return res.status(409).json({
            message: 'This mobile number is already added in your contact list.'
          });
        }

        return res.status(409).json({
          message: 'This email is already added in your contact list.'
        });
      }
    }

    const customer = await Customer.findOneAndUpdate(
      {
        _id: req.params.id,
        accountId
      },
      { $set: patch },
      {
        new: true,
        runValidators: true
      }
    ).lean();

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    return res.json(publicCustomer(customer));
  } catch (error) {
    return next(error);
  }
});

/*
 * DELETE /api/customers/:id
 */
router.delete('/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: 'Invalid customer ID.' });
    }

    const accountId = requestedAccountId(req);

    if (!accountId) {
      return res.status(400).json({ message: 'Account ID is required.' });
    }

    const customer = await Customer.findOneAndDelete({
      _id: req.params.id,
      accountId
    }).lean();

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found.' });
    }

    return res.json({ message: 'Customer deleted successfully.' });
  } catch (error) {
    return next(error);
  }
});

export default router;

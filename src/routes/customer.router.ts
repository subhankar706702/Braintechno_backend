import { Router } from 'express';
import mongoose from 'mongoose';

import { requireAuth } from '../middleware/auth.js';
import { Campaign } from '../models/campaign.model.js';
import {
  Customer,
  CUSTOMER_SOURCES,
  CUSTOMER_TYPES,
  DEFAULT_CUSTOMER_SOURCE,
  DEFAULT_CUSTOMER_TYPE,
} from '../models/customer.model.js';
import { Message } from '../models/message.model.js';
import { User } from '../models/user.model.js';

const router = Router();

const cleanText = (value: unknown): string =>
  String(value ?? '').trim();

const normalizeSlug = (value: unknown): string =>
  cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizePhone = (value: unknown): string =>
  cleanText(value).replace(/[^0-9+]/g, '');

const normalizePhoneKey = (value: unknown): string => {
  const digits = normalizePhone(value).replace(/\D/g, '');

  let mobile = digits;

  if (digits.length === 13 && digits.startsWith('091')) {
    mobile = digits.slice(3);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    mobile = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    mobile = digits.slice(1);
  }

  return /^[6-9]\d{9}$/.test(mobile) ? mobile : '';
};

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
  address: cleanText(item.address),
  gstin: cleanText(item.gstin),
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
      { status: 409 },
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
        message: 'Campaign URL is required.',
      });
    }

    if (!name) {
      return res.status(400).json({
        message: 'Customer name is required.',
      });
    }

    if (!mobile) {
      return res.status(400).json({
        message: 'Customer mobile number is required.',
      });
    }

    if (!messageText) {
      return res.status(400).json({
        message: 'Message is required.',
      });
    }

    if (messageText.length > 2000) {
      return res.status(400).json({
        message: 'Message cannot exceed 2000 characters.',
      });
    }

    const campaign = await Campaign.findOne({
      businessSlug,
      pageSlug,
      status: 'published',
    })
      .select('_id businessId name pageSlug businessSlug status')
      .lean();

    if (!campaign) {
      return res.status(404).json({
        message: 'Campaign not found or not published.',
      });
    }

    const accountId = await resolveAccountForCampaign(campaign);
    const mobileNormalized = normalizePhoneKey(mobile);

    if (!mobileNormalized) {
      return res.status(400).json({
        message: 'Enter a valid 10-digit Indian mobile number.',
      });
    }

    let customer = await Customer.findOne({
      accountId,
      mobileNormalized,
    });

    if (!customer) {
      customer = new Customer({
        accountId,
        businessId: campaign.businessId,
        name,
        mobile,
        mobileNormalized,
        email,
        emailNormalized: email,
        customerType: DEFAULT_CUSTOMER_TYPE,
        source: CAMPAIGN_SOURCE,
        lastContactAt: new Date(),
      });

      await customer.save();
    } else {
      const customerPatch: Record<string, unknown> = {
        lastContactAt: new Date(),
      };

      if (name) customerPatch.name = name;

      if (email) {
        customerPatch.email = email;
        customerPatch.emailNormalized = email;
      }

      customer = await Customer.findOneAndUpdate(
        {
          _id: customer._id,
          accountId,
        },
        { $set: customerPatch },
        {
          new: true,
          runValidators: true,
        },
      );
    }

    if (!customer) {
      return res.status(500).json({
        message: 'Could not save customer.',
      });
    }

    const created = new Message({
      accountId,
      businessId: campaign.businessId,
      customerId: customer._id,
      campaignId: campaign._id,
      campaignName: campaign.name,
      campaignSlug: campaign.pageSlug,
      source: 'Campaign' as const,
      customerName: name,
      customerMobile: mobile,
      customerEmail: email,
      message: messageText,
      readStatus: 'unread',
      queryStatus: 'New',
    });

    await created.save();

    return res.status(201).json({
      message: 'Message received successfully.',
      item: publicMessage(created.toObject()),
    });
  } catch (error: any) {
    if (error?.status) {
      return res.status(error.status).json({
        message: error.message,
      });
    }

    return next(error);
  }
});

router.use(requireAuth);

function requestedAccountId(req: any): string {
  if (req.auth?.role === 'admin') {
    return cleanText(req.query?.accountId ?? req.body?.accountId);
  }

  return cleanText(req.auth?.accountId);
}

async function buildCustomerCounts(filter: Record<string, unknown>) {
  const total = await Customer.countDocuments(filter);

  const entries = await Promise.all(
    CUSTOMER_TYPES.map(async type => [
      type,
      await Customer.countDocuments({
        ...filter,
        customerType: type,
      }),
    ] as const),
  );

  return {
    total,
    byType: Object.fromEntries(entries),
  };
}

/*
 * GET /api/customers/options
 */
router.get('/options', (_req, res) => {
  return res.json({
    customerTypes: [...CUSTOMER_TYPES],
    customerSources: [...CUSTOMER_SOURCES],
  });
});

/*
 * GET /api/customers/by-mobile/:mobile
 * Mobile-only customer lookup within the authenticated account.
 */
router.get('/by-mobile/:mobile', async (req, res, next) => {
  try {
    const accountId = requestedAccountId(req);

    if (!accountId) {
      return res.status(400).json({
        message: 'Account ID is required.',
      });
    }

    const mobileNormalized = normalizePhoneKey(req.params.mobile);

    if (!mobileNormalized) {
      return res.status(400).json({
        message: 'Enter a valid 10-digit Indian mobile number.',
      });
    }

    const customer = await Customer.findOne({
      accountId,
      mobileNormalized,
    }).lean();

    return res.json({
      item: customer ? publicCustomer(customer) : null,
    });
  } catch (error) {
    return next(error);
  }
});

/*
 * POST /api/customers/from-invoice
 * Creates a customer or updates an existing customer by mobile.
 * GSTIN is deliberately excluded from this operation.
 */
router.post('/from-invoice', async (req, res, next) => {
  try {
    const accountId = requestedAccountId(req);

    if (!accountId) {
      return res.status(400).json({
        message: 'Account ID is required.',
      });
    }

    const name = cleanText(req.body?.name);
    const mobile = normalizePhone(req.body?.mobile);
    const mobileNormalized = normalizePhoneKey(mobile);
    const email = normalizeEmail(req.body?.email);
    const address = cleanText(req.body?.address);
    const updateExisting = req.body?.updateExisting === true;

    if (!mobileNormalized) {
      return res.status(400).json({
        message: 'Enter a valid 10-digit Indian mobile number.',
      });
    }

    if (!name) {
      return res.status(400).json({
        message: 'Customer name is required.',
      });
    }

    let customer = await Customer.findOne({
      accountId,
      mobileNormalized,
    });

    if (customer) {
      if (!updateExisting) {
        return res.json({
          item: publicCustomer(customer.toObject()),
          created: false,
          updated: false,
        });
      }

      // Only the explicitly approved customer details are updated.
      // Mobile, mobileNormalized, GSTIN and all other customer fields stay unchanged.
      customer.name = name;
      customer.email = email;
      customer.emailNormalized = email;
      customer.address = address;

      await customer.save();

      return res.json({
        item: publicCustomer(customer.toObject()),
        created: false,
        updated: true,
      });
    }

    customer = new Customer({
      accountId,
      businessId: req.auth?.businessId,
      name,
      mobile,
      mobileNormalized,
      email,
      emailNormalized: email,
      address,
      customerType: DEFAULT_CUSTOMER_TYPE,
      source: DEFAULT_CUSTOMER_SOURCE,
      lastContactAt: new Date(),
    });

    try {
      await customer.save();
    } catch (error: any) {
      // Handles simultaneous requests for the same mobile number.
      if (error?.code === 11000) {
        const existing = await Customer.findOne({
          accountId,
          mobileNormalized,
        });

        if (existing) {
          return res.json({
            item: publicCustomer(existing.toObject()),
            created: false,
            updated: false,
          });
        }
      }

      throw error;
    }

    return res.status(201).json({
      item: publicCustomer(customer.toObject()),
      created: true,
      updated: false,
    });
  } catch (error) {
    return next(error);
  }
});

/*
 * GET /api/customers
 */
router.get('/', async (req, res, next) => {
  try {
    const accountId = requestedAccountId(req);

    if (!accountId) {
      return res.status(400).json({
        message: 'Account ID is required.',
      });
    }

    const filter: Record<string, unknown> = { accountId };

    const search = cleanText(req.query?.search);
    const type = cleanText(req.query?.type);
    const source = cleanText(req.query?.source);
    const sort = cleanText(req.query?.sort) || 'newest';
    const page = Math.max(1, Number(req.query?.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query?.limit) || 20));

    if (type) {
      if (!isCustomerType(type)) {
        return res.status(400).json({
          message: 'Invalid customer type.',
        });
      }

      filter.customerType = type;
    }

    if (source) {
      if (!isCustomerSource(source)) {
        return res.status(400).json({
          message: 'Invalid customer source.',
        });
      }

      filter.source = source;
    }

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');

      filter.$or = [
        { name: rx },
        { mobile: rx },
        { email: rx },
      ];
    }

    const sortMap: Record<string, Record<string, 1 | -1>> = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      name_asc: { name: 1, createdAt: -1 },
      name_desc: { name: -1, createdAt: -1 },
    };

    const sortValue = sortMap[sort] ?? sortMap.newest;

    const [items, total, counts] = await Promise.all([
      Customer.find(filter)
        .sort(sortValue)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Customer.countDocuments(filter),
      buildCustomerCounts({ accountId }),
    ]);

    return res.json({
      items: items.map(publicCustomer),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
      counts,
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
        message: 'Account ID is required.',
      });
    }

    const name = cleanText(req.body?.name);
    const mobile = normalizePhone(req.body?.mobile);
    const email = normalizeEmail(req.body?.email);
    const address = cleanText(req.body?.address);
    const image = cleanText(req.body?.image);

    const customerTypeValue =
      cleanText(req.body?.customerType) || CUSTOMER_TYPES[0] || '';

    const sourceValue =
      cleanText(req.body?.source) || CUSTOMER_SOURCES[0] || '';

    if (!name && !mobile && !email) {
      return res.status(400).json({
        message: 'Enter at least a name, mobile number or email.',
      });
    }

    if (!isCustomerType(customerTypeValue)) {
      return res.status(400).json({
        message: 'Invalid customer type.',
      });
    }

    if (!isCustomerSource(sourceValue)) {
      return res.status(400).json({
        message: 'Invalid customer source.',
      });
    }

    const customerType =
      customerTypeValue as (typeof CUSTOMER_TYPES)[number];

    const source =
      sourceValue as (typeof CUSTOMER_SOURCES)[number];

    const mobileNormalized = mobile ? normalizePhoneKey(mobile) : '';

    if (mobile && !mobileNormalized) {
      return res.status(400).json({
        message: 'Enter a valid 10-digit Indian mobile number.',
      });
    }

    // Only mobile number is unique. Duplicate emails are allowed.
    if (mobileNormalized) {
      const duplicate = await Customer.findOne({
        accountId,
        mobileNormalized,
      }).lean();

      if (duplicate) {
        return res.status(409).json({
          message: `This mobile number (${mobile}) is already added in your contact list.`,
        });
      }
    }

    const customer = new Customer({
      accountId,
      businessId: req.auth?.businessId,
      name,
      mobile,
      mobileNormalized,
      email,
      emailNormalized: email,
      address,
      customerType,
      source,
      image,
    });

    await customer.save();

    return res.status(201).json(publicCustomer(customer.toObject()));
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({
        message: 'This mobile number is already added in your contact list.',
      });
    }

    return next(error);
  }
});

/*
 * PATCH /api/customers/:id
 */
router.patch('/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: 'Invalid customer ID.',
      });
    }

    const accountId = requestedAccountId(req);

    if (!accountId) {
      return res.status(400).json({
        message: 'Account ID is required.',
      });
    }

    const patch: Record<string, unknown> = {};

    if (req.body?.name !== undefined) {
      patch.name = cleanText(req.body.name);
    }

    if (req.body?.mobile !== undefined) {
      const mobile = normalizePhone(req.body.mobile);
      const mobileNormalized = mobile ? normalizePhoneKey(mobile) : '';

      if (mobile && !mobileNormalized) {
        return res.status(400).json({
          message: 'Enter a valid 10-digit Indian mobile number.',
        });
      }

      patch.mobile = mobile;
      patch.mobileNormalized = mobileNormalized;
    }

    if (req.body?.email !== undefined) {
      const email = normalizeEmail(req.body.email);
      patch.email = email;
      patch.emailNormalized = email;
    }

    if (req.body?.address !== undefined) {
      patch.address = cleanText(req.body.address);
    }

    if (req.body?.image !== undefined) {
      patch.image = cleanText(req.body.image);
    }

    if (req.body?.customerType !== undefined) {
      const customerType = cleanText(req.body.customerType);

      if (!isCustomerType(customerType)) {
        return res.status(400).json({
          message: 'Invalid customer type.',
        });
      }

      patch.customerType = customerType;
    }

    if (req.body?.source !== undefined) {
      const source = cleanText(req.body.source);

      if (!isCustomerSource(source)) {
        return res.status(400).json({
          message: 'Invalid customer source.',
        });
      }

      patch.source = source;
    }

    if (!Object.keys(patch).length) {
      return res.status(400).json({
        message: 'No customer changes supplied.',
      });
    }

    if (patch.mobileNormalized) {
      const duplicate = await Customer.findOne({
        accountId,
        _id: { $ne: req.params.id },
        mobileNormalized: patch.mobileNormalized,
      }).lean();

      if (duplicate) {
        return res.status(409).json({
          message: 'This mobile number is already added in your contact list.',
        });
      }
    }

    // Email duplicates are allowed. No email uniqueness check here.
    const customer = await Customer.findOneAndUpdate(
      {
        _id: req.params.id,
        accountId,
      },
      { $set: patch },
      {
        new: true,
        runValidators: true,
      },
    ).lean();

    if (!customer) {
      return res.status(404).json({
        message: 'Customer not found.',
      });
    }

    return res.json(publicCustomer(customer));
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({
        message: 'This mobile number is already added in your contact list.',
      });
    }

    return next(error);
  }
});

/*
 * DELETE /api/customers/:id
 */
router.delete('/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: 'Invalid customer ID.',
      });
    }

    const accountId = requestedAccountId(req);

    if (!accountId) {
      return res.status(400).json({
        message: 'Account ID is required.',
      });
    }

    const customer = await Customer.findOneAndDelete({
      _id: req.params.id,
      accountId,
    }).lean();

    if (!customer) {
      return res.status(404).json({
        message: 'Customer not found.',
      });
    }

    return res.json({
      message: 'Customer deleted successfully.',
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
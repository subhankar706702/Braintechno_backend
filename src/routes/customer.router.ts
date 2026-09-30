import { Router } from 'express';

import { requireAuth } from '../middleware/auth.js';

import {
  Customer,
  CUSTOMER_SOURCES,
  CUSTOMER_TYPES
} from '../models/customer.model.js';


const router = Router();

router.use(requireAuth);


type CustomerType = typeof CUSTOMER_TYPES[number];
type CustomerSource = typeof CUSTOMER_SOURCES[number];


function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeMobile(value: unknown): string {
  return cleanText(value).replace(/\D/g, '');
}

function normalizeEmail(value: unknown): string {
  return cleanText(value).toLowerCase();
}

async function duplicateContact(
  accountId: string,
  mobile: string,
  email: string,
  excludeId?: string
): Promise<{ mobile: boolean; email: boolean }> {
  const or: any[] = [];
  const mobileNormalized = normalizeMobile(mobile);
  const emailNormalized = normalizeEmail(email);

  if (mobileNormalized) {
    or.push({ mobileNormalized });
  }

  if (emailNormalized) {
    or.push({ emailNormalized });
  }

  if (!or.length) {
    return { mobile: false, email: false };
  }

  const query: any = { accountId, $or: or };

  if (excludeId) {
    query._id = { $ne: excludeId };
  }

  const matches = await Customer.find(query)
    .select('mobileNormalized emailNormalized')
    .lean();

  return {
    mobile: !!mobileNormalized && matches.some(item => item.mobileNormalized === mobileNormalized),
    email: !!emailNormalized && matches.some(item => item.emailNormalized === emailNormalized)
  };
}

function duplicateMessage(duplicate: { mobile: boolean; email: boolean }): string {
  const messages: string[] = [];

  if (duplicate.mobile) {
    messages.push('This mobile number is already added in your contact list.');
  }

  if (duplicate.email) {
    messages.push('This email is already added in your contact list.');
  }

  return messages.join(' ');
}


function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


function getAccountId(req: any, res: any): string | null {
  const tokenAccountId = cleanText(req.auth?.accountId);

  const requestedAccountId = cleanText(
    req.query?.accountId ?? req.body?.accountId
  );

  if (req.auth?.role === 'admin') {
    const value = requestedAccountId || tokenAccountId;

    if (!value) {
      res.status(400).json({
        message: 'accountId is required.'
      });

      return null;
    }

    return value;
  }

  if (!tokenAccountId) {
    res.status(403).json({
      message: 'Your login session does not contain an account ID.'
    });

    return null;
  }

  if (
    requestedAccountId &&
    requestedAccountId !== tokenAccountId
  ) {
    res.status(403).json({
      message: 'You cannot access customers from another account.'
    });

    return null;
  }

  return tokenAccountId;
}


function normalizeType(value: unknown): CustomerType | '' {
  const text = cleanText(value);

  if (!text) {
    return '';
  }

  const normalized = text.toLowerCase();

  const typeMap: Record<string, CustomerType> = {
    new: 'New',
    regular: 'Regular',
    vip: 'VIP',
    interested: 'Interested',
    followup: 'Followup',
    converted: 'Converted'
  };

  return typeMap[normalized] ?? '';
}


function normalizeSource(value: unknown): CustomerSource | '' {
  const text = cleanText(value);

  return (CUSTOMER_SOURCES as readonly string[]).includes(text)
    ? (text as CustomerSource)
    : '';
}


function publicCustomer(item: any) {
  return {
    id: String(item._id),
    accountId: cleanText(item.accountId),
    name: cleanText(item.name),
    mobile: cleanText(item.mobile),
    email: cleanText(item.email),
    customerType: item.customerType,
    source: item.source,
    image: cleanText(item.image),
    lastContactAt: item.lastContactAt ?? null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
}


async function buildCounts(accountId: string) {
  const [
    total,
    newCount,
    regular,
    vip,
    interested,
    followup,
    converted
  ] = await Promise.all([
    Customer.countDocuments({
      accountId
    }),

    Customer.countDocuments({
      accountId,
      customerType: 'New'
    }),

    Customer.countDocuments({
      accountId,
      customerType: 'Regular'
    }),

    Customer.countDocuments({
      accountId,
      customerType: 'VIP'
    }),

    Customer.countDocuments({
      accountId,
      customerType: 'Interested'
    }),

    Customer.countDocuments({
      accountId,
      customerType: 'Followup'
    }),

    Customer.countDocuments({
      accountId,
      customerType: 'Converted'
    })
  ]);

  return {
    total,
    new: newCount,
    regular,
    vip,
    interested,
    followup,
    converted
  };
}


/*
 * GET /api/customers
 *
 * Query:
 * accountId
 * page
 * limit
 * search
 * type
 * source
 * sort
 */
router.get(
  '/',
  async (req, res, next) => {
    try {
      const accountId = getAccountId(req, res);

      if (!accountId) {
        return;
      }

      const page = Math.max(
        1,
        Number(req.query.page ?? 1) || 1
      );

      const limit = Math.min(
        50,
        Math.max(
          1,
          Number(req.query.limit ?? 16) || 16
        )
      );

      const search = cleanText(req.query.search);
      const type = normalizeType(req.query.type);
      const source = normalizeSource(req.query.source);

      const sort =
        cleanText(req.query.sort) ||
        'newest';

      const filter: any = {
        accountId
      };

      if (type) {
        filter.customerType = type;
      }

      if (source) {
        filter.source = source;
      }

      if (search) {
        const regex = new RegExp(
          escapeRegExp(search),
          'i'
        );

        filter.$or = [
          {
            name: regex
          },
          {
            mobile: regex
          },
          {
            email: regex
          }
        ];
      }

      let sortValue: Record<string, 1 | -1> = {
        createdAt: -1
      };

      if (sort === 'oldest') {
        sortValue = {
          createdAt: 1
        };
      }

      if (sort === 'name_asc') {
        sortValue = {
          name: 1,
          createdAt: -1
        };
      }

      if (sort === 'name_desc') {
        sortValue = {
          name: -1,
          createdAt: -1
        };
      }

      const [
        items,
        total,
        counts
      ] = await Promise.all([
        Customer
          .find(filter)
          .sort(sortValue)
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),

        Customer.countDocuments(filter),

        buildCounts(accountId)
      ]);

      const totalPages = Math.max(
        1,
        Math.ceil(total / limit)
      );

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
  }
);


/*
 * POST /api/customers
 * Manual customer create
 */
router.post(
  '/',
  async (req, res, next) => {
    try {
      const accountId = getAccountId(req, res);

      if (!accountId) {
        return;
      }

      const customerType =
        normalizeType(req.body?.customerType) ||
        'New';

      const source =
        normalizeSource(req.body?.source) ||
        'Manual';

      const mobile = cleanText(req.body?.mobile);
      const email = normalizeEmail(req.body?.email);
      const duplicate = await duplicateContact(accountId, mobile, email);

      if (duplicate.mobile || duplicate.email) {
        return res.status(409).json({
          message: duplicateMessage(duplicate),
          duplicate
        });
      }

      const customer = await Customer.create({
        accountId,

        businessId:
          req.auth?.businessId ||
          undefined,

        name: cleanText(
          req.body?.name
        ),

        mobile,
        mobileNormalized: normalizeMobile(mobile),

        email,
        emailNormalized: normalizeEmail(email),

        customerType,
        source,

        image: cleanText(
          req.body?.image
        ),

        lastContactAt:
          req.body?.lastContactAt ||
          null
      });

      return res
        .status(201)
        .json(
          publicCustomer(
            customer.toObject()
          )
        );
    } catch (error) {
      return next(error);
    }
  }
);


/*
 * PATCH /api/customers/:id
 */
router.patch(
  '/:id',
  async (req, res, next) => {
    try {
      const accountId = getAccountId(req, res);

      if (!accountId) {
        return;
      }

      const patch: Record<string, unknown> = {};

      const existing = await Customer.findOne({
        _id: req.params.id,
        accountId
      }).lean();

      if (!existing) {
        return res.status(404).json({
          message: 'Customer not found.'
        });
      }

      if ('name' in req.body) {
        patch.name = cleanText(
          req.body.name
        );
      }

      const nextMobile = 'mobile' in req.body
        ? cleanText(req.body.mobile)
        : cleanText(existing.mobile);

      const nextEmail = 'email' in req.body
        ? normalizeEmail(req.body.email)
        : normalizeEmail(existing.email);

      if ('mobile' in req.body) {
        patch.mobile = nextMobile;
        patch.mobileNormalized = normalizeMobile(nextMobile);
      }

      if ('email' in req.body) {
        patch.email = nextEmail;
        patch.emailNormalized = normalizeEmail(nextEmail);
      }

      const duplicate = await duplicateContact(
        accountId,
        nextMobile,
        nextEmail,
        req.params.id
      );

      if (duplicate.mobile || duplicate.email) {
        return res.status(409).json({
          message: duplicateMessage(duplicate),
          duplicate
        });
      }

      if ('image' in req.body) {
        patch.image = cleanText(
          req.body.image
        );
      }

      const customerType = normalizeType(
        req.body?.customerType
      );

      if (customerType) {
        patch.customerType = customerType;
      }

      const source = normalizeSource(
        req.body?.source
      );

      if (source) {
        patch.source = source;
      }

      if ('lastContactAt' in req.body) {
        patch.lastContactAt =
          req.body.lastContactAt ||
          null;
      }

      const customer = await Customer
        .findOneAndUpdate(
          {
            _id: req.params.id,
            accountId
          },
          {
            $set: patch
          },
          {
            new: true,
            runValidators: true
          }
        )
        .lean();

      if (!customer) {
        return res
          .status(404)
          .json({
            message: 'Customer not found.'
          });
      }

      return res.json(
        publicCustomer(customer)
      );
    } catch (error) {
      return next(error);
    }
  }
);


/*
 * DELETE /api/customers/:id
 */
router.delete(
  '/:id',
  async (req, res, next) => {
    try {
      const accountId = getAccountId(req, res);

      if (!accountId) {
        return;
      }

      const customer = await Customer.findOneAndDelete({
        _id: req.params.id,
        accountId
      });

      if (!customer) {
        return res
          .status(404)
          .json({
            message: 'Customer not found.'
          });
      }

      return res.json({
        message: 'Customer deleted successfully.'
      });
    } catch (error) {
      return next(error);
    }
  }
);


function normalizeImportRows(
  rows: unknown[],
  accountId: string,
  businessId: unknown,
  source: CustomerSource
) {
  return rows
    .slice(0, 2000)
    .map((row: any) => {
      const type =
        normalizeType(
          row?.customerType ??
          row?.type
        ) ||
        'New';

      return {
        accountId,

        businessId:
          businessId ||
          undefined,

        name: cleanText(
          row?.name ??
          row?.customerName
        ),

        mobile: cleanText(
          row?.mobile ??
          row?.phone ??
          row?.contact
        ),

        email: cleanText(
          row?.email
        ).toLowerCase(),

        customerType: type,
        source,

        image: cleanText(
          row?.image
        ),

        lastContactAt:
          row?.lastContactAt ||
          null
      };
    })
    .filter(
      row =>
        row.name ||
        row.mobile ||
        row.email
    );
}


/*
 * POST /api/customers/import/excel
 *
 * Body:
 * {
 *   accountId,
 *   rows: [...]
 * }
 *
 * Frontend can parse the Excel sheet and send
 * normalized rows here.
 */
router.post(
  '/import/excel',
  async (req, res, next) => {
    try {
      const accountId = getAccountId(req, res);

      if (!accountId) {
        return;
      }

      const rows = Array.isArray(
        req.body?.rows
      )
        ? req.body.rows
        : [];

      const normalized = normalizeImportRows(
        rows,
        accountId,
        req.auth?.businessId,
        'Excel'
      );

      if (normalized.length === 0) {
        return res
          .status(400)
          .json({
            message:
              'No valid customer rows were provided.'
          });
      }

      const result = await Customer.insertMany(
        normalized,
        {
          ordered: false
        }
      );

      return res
        .status(201)
        .json({
          imported: result.length
        });
    } catch (error) {
      return next(error);
    }
  }
);


/*
 * POST /api/customers/import/ai
 *
 * Body:
 * {
 *   accountId,
 *   rows: [...]
 * }
 *
 * rows are structured records returned by the
 * selected AI extraction workflow.
 */
router.post(
  '/import/ai',
  async (req, res, next) => {
    try {
      const accountId = getAccountId(req, res);

      if (!accountId) {
        return;
      }

      const rows = Array.isArray(
        req.body?.rows
      )
        ? req.body.rows
        : [];

      const normalized = normalizeImportRows(
        rows,
        accountId,
        req.auth?.businessId,
        'AI'
      );

      if (normalized.length === 0) {
        return res
          .status(400)
          .json({
            message:
              'No valid AI customer rows were provided.'
          });
      }

      const result = await Customer.insertMany(
        normalized,
        {
          ordered: false
        }
      );

      return res
        .status(201)
        .json({
          imported: result.length
        });
    } catch (error) {
      return next(error);
    }
  }
);


export default router;

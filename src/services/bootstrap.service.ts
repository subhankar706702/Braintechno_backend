import bcrypt from 'bcryptjs';

import { Business } from '../models/business.model.js';
import { Campaign } from '../models/campaign.model.js';
import { Counter } from '../models/counter.model.js';
import { Template } from '../models/template.model.js';
import { User } from '../models/user.model.js';

import { normalizeLegacyDesign } from '../utils/serialize.js';

const ADMIN_EMAIL = 'admin@braintechno.com';
const ADMIN_PASSWORD = 'admin@braintechno.com';

export async function bootstrapDevelopmentData(): Promise<void> {
  /**
   * ----------------------------------------------------
   * 1. ADMIN BUSINESS
   * ----------------------------------------------------
   */



  let business = await Business.findOne({
    slug: 'brain-techno-admin',
  });

  if (!business) {
    business = await Business.create({
      name: 'BRAIN TECHNO Admin',
      slug: 'brain-techno-admin',
      status: 'active',
    });
  }


  

  /**
   * ----------------------------------------------------
   * 2. ADMIN USER
   * ----------------------------------------------------
   */
  const passwordHash = await bcrypt.hash(
    ADMIN_PASSWORD,
    12,
  );

  let admin = await User.findOne({
    email: ADMIN_EMAIL,
  });

  if (!admin) {
    admin = await User.create({
      accountId: 0,
      name: 'BRAIN TECHNO Admin',
      email: ADMIN_EMAIL,
      passwordHash,
      businessId: business._id,
      role: 'admin',
    });
  } else {
    admin.accountId = 0;
    admin.name = 'BRAIN TECHNO Admin';
    admin.email = ADMIN_EMAIL;
    admin.passwordHash = passwordHash;
    admin.businessId = business._id;
    admin.role = 'admin';

    await admin.save();
  }

  /**
   * ----------------------------------------------------
   * 3. SET BUSINESS OWNER
   * ----------------------------------------------------
   */
  if (!business.ownerId) {
    business.ownerId = admin._id;

    await business.save();
  }

  /**
   * ----------------------------------------------------
   * 4. FIND CURRENT MAX ACCOUNT ID
   * ----------------------------------------------------
   *
   * Example:
   *
   * BT00001
   * BT00002
   * BT00015
   *
   * maxSeq = 15
   */
  const existingIds = await User.find({
    accountId: /^BT\d{5}$/,
  })
    .select('accountId')
    .lean();

  const maxSeq = existingIds.reduce(
    (max: number, user: any) => {
      const accountId = String(
        user.accountId || '',
      );

      const numericValue = Number(
        accountId.slice(2),
      );

      if (
        Number.isNaN(numericValue)
      ) {
        return max;
      }

      return Math.max(
        max,
        numericValue,
      );
    },
    0,
  );

  /**
   * ----------------------------------------------------
   * 5. INITIALIZE ACCOUNT ID COUNTER
   * ----------------------------------------------------
   *
   * IMPORTANT:
   *
   * Do not use:
   *
   * $max: { seq: maxSeq }
   * +
   * $setOnInsert: { seq: maxSeq }
   *
   * together because MongoDB throws:
   *
   * ConflictingUpdateOperators
   */
  let accountCounter = await Counter.findOne({
    key: 'accountId',
  });

  if (!accountCounter) {
    accountCounter = await Counter.create({
      key: 'accountId',
      seq: maxSeq,
    });
  } else if (
    Number(accountCounter.seq || 0) < maxSeq
  ) {
    accountCounter.seq = maxSeq;

    await accountCounter.save();
  }

  /**
   * ----------------------------------------------------
   * 6. MIGRATE EXISTING USERS WITHOUT ACCOUNT ID
   * ----------------------------------------------------
   */
  const usersWithoutaccountId = await User.find({
    role: {
      $ne: 'admin',
    },
    $or: [
      {
        accountId: {
          $exists: false,
        },
      },
      {
        accountId: null,
      },
      {
        accountId: '',
      },
    ],
  }).sort({
    _id: 1,
  });

  for (
    const user of usersWithoutaccountId
  ) {
    const counter =
      await Counter.findOneAndUpdate(
        {
          key: 'accountId',
        },
        {
          $inc: {
            seq: 1,
          },
        },
        {
          returnDocument: 'after',
        },
      );

    if (!counter) {
      throw new Error(
        'Could not generate account ID.',
      );
    }

    user.accountId =
      `BT${String(counter.seq).padStart(
        5,
        '0',
      )}`;

    await user.save();
  }

  /**
   * ----------------------------------------------------
   * 7. MIGRATE LEGACY TEMPLATES
   * ----------------------------------------------------
   */
  const rawTemplates =
    await Template.collection
      .find({
        $or: [
          {
            businessId: {
              $exists: false,
            },
          },
          {
            businessId: null,
          },
          {
            accountId: {
              $exists: false,
            },
          },
          {
            accountId: null,
          },
        ],
      })
      .toArray();

  for (
    const raw of rawTemplates
  ) {
    const rawData = raw as any;

    const name = String(
      rawData.name ||
      rawData.templateName ||
      rawData.title ||
      'Untitled Template',
    ).trim();

    /**
     * Try finding owner using the template's
     * existing businessId.
     */
    let owner = null;

    if (rawData.businessId) {
      owner = await User.findOne({
        businessId: rawData.businessId,
      }).lean();
    }

    /**
     * If legacy template has no owner/business,
     * attach it to admin account.
     */
    const resolvedBusinessId =
      rawData.businessId ||
      business._id;

    const resolvedaccountId =
      owner?.accountId ?? 0;

    await Template.collection.updateOne(
      {
        _id: raw._id,
      },
      {
        $set: {
          businessId:
            resolvedBusinessId,

          accountId:
            resolvedaccountId,

          name,

          description: String(
            rawData.description ||
            '',
          ),

          design:
            normalizeLegacyDesign(
              rawData.design,
            ),

          html: String(
            rawData.html || '',
          ),

          previewImage: String(
            rawData.previewImage ||
            '',
          ),

          previewImageName: String(
            rawData.previewImageName ||
            '',
          ),

          status: [
            'draft',
            'published',
            'locked',
          ].includes(
            rawData.status,
          )
            ? rawData.status
            : 'draft',
        },
      },
    );
  }

  /**
   * ----------------------------------------------------
   * 8. MIGRATE LEGACY CAMPAIGNS
   * ----------------------------------------------------
   */
  await Campaign.collection.updateMany(
    {
      $or: [
        {
          businessId: {
            $exists: false,
          },
        },
        {
          businessId: null,
        },
      ],
    },
    {
      $set: {
        businessId:
          business._id,
      },
    },
  );

  console.log(
    '[BRAIN TECHNO] Development bootstrap completed.',
  );
}
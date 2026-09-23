import bcrypt from 'bcryptjs';

import { Business } from '../models/business.model';
import { Campaign } from '../models/campaign.model';
import { Counter } from '../models/counter.model';
import { Template } from '../models/template.model';
import { User } from '../models/user.model';

import { normalizeLegacyDesign } from '../utils/serialize';

const ADMIN_EMAIL = 'admin@braintechno.com';
const ADMIN_PASSWORD = 'admin@braintechno.com';

const ADMIN_MOBILE = '0000000000';
const ADMIN_BUSINESS_NAME = 'BRAIN TECHNO Admin';
const ADMIN_BUSINESS_CATEGORY = 'General';

export async function bootstrapDevelopmentData(): Promise<void> {
  /**
   * ----------------------------------------------------
   * 1. ADMIN BUSINESS
   * ----------------------------------------------------
   */

  let business = await Business.findOne({
    slug: 'brain-techno-admin'
  });

  if (!business) {
    business = await Business.create({
      name: ADMIN_BUSINESS_NAME,
      slug: 'brain-techno-admin',
      status: 'active'
    });
  }

  /**
   * ----------------------------------------------------
   * 2. ADMIN USER
   * ----------------------------------------------------
   */

  const passwordHash = await bcrypt.hash(
    ADMIN_PASSWORD,
    12
  );

  let admin = await User.findOne({
    email: ADMIN_EMAIL
  });

  if (!admin) {
    admin = await User.create({
      accountId: 0,

      ownerName: 'BRAIN TECHNO Admin',

      mobile: ADMIN_MOBILE,

      email: ADMIN_EMAIL,

      businessName: ADMIN_BUSINESS_NAME,

      businessCategory:
        ADMIN_BUSINESS_CATEGORY,

      passwordHash,

      businessId: business._id,

      role: 'admin'
    });
  } else {
    admin.accountId = 0;

    admin.ownerName =
      'BRAIN TECHNO Admin';

    admin.mobile =
      admin.mobile ||
      ADMIN_MOBILE;

    admin.email =
      ADMIN_EMAIL;

    admin.businessName =
      admin.businessName ||
      ADMIN_BUSINESS_NAME;

    admin.businessCategory =
      admin.businessCategory ||
      ADMIN_BUSINESS_CATEGORY;

    admin.passwordHash =
      passwordHash;

    admin.businessId =
      business._id;

    admin.role =
      'admin';

    await admin.save();
  }

  /**
   * ----------------------------------------------------
   * 3. SET BUSINESS OWNER
   * ----------------------------------------------------
   */

  if (
    !business.ownerId ||
    String(business.ownerId) !==
      String(admin._id)
  ) {
    business.ownerId =
      admin._id;

    await business.save();
  }

  /**
   * ----------------------------------------------------
   * 4. FIND CURRENT MAX ACCOUNT ID
   * ----------------------------------------------------
   */

  const existingIds = await User.find({
    accountId: /^BT\d{5}$/
  })
    .select('accountId')
    .lean();

  const maxSeq = existingIds.reduce(
    (
      max: number,
      user
    ) => {
      const accountId = String(
        user.accountId || ''
      );

      const numericValue = Number(
        accountId.slice(2)
      );

      if (
        Number.isNaN(
          numericValue
        )
      ) {
        return max;
      }

      return Math.max(
        max,
        numericValue
      );
    },
    0
  );

  /**
   * ----------------------------------------------------
   * 5. INITIALIZE ACCOUNT ID COUNTER
   * ----------------------------------------------------
   */

  let accountCounter =
    await Counter.findOne({
      key: 'accountId'
    });

  if (!accountCounter) {
    accountCounter =
      await Counter.create({
        key: 'accountId',
        seq: maxSeq
      });
  } else if (
    Number(
      accountCounter.seq || 0
    ) < maxSeq
  ) {
    accountCounter.seq =
      maxSeq;

    await accountCounter.save();
  }

  /**
   * ----------------------------------------------------
   * 6. MIGRATE EXISTING USERS WITHOUT ACCOUNT ID
   * ----------------------------------------------------
   */

  const usersWithoutAccountId =
    await User.find({
      role: {
        $ne: 'admin'
      },

      $or: [
        {
          accountId: {
            $exists: false
          }
        },
        {
          accountId: null
        },
        {
          accountId: ''
        }
      ]
    }).sort({
      _id: 1
    });

  for (
    const user of usersWithoutAccountId
  ) {
    const counter =
      await Counter.findOneAndUpdate(
        {
          key: 'accountId'
        },
        {
          $inc: {
            seq: 1
          }
        },
        {
          new: true
        }
      );

    if (!counter) {
      throw new Error(
        'Could not generate account ID.'
      );
    }

    user.accountId =
      `BT${String(
        counter.seq
      ).padStart(
        5,
        '0'
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
              $exists: false
            }
          },
          {
            businessId: null
          },
          {
            accountId: {
              $exists: false
            }
          },
          {
            accountId: null
          }
        ]
      })
      .toArray();

  for (
    const raw of rawTemplates
  ) {
    const rawData =
      raw as Record<
        string,
        any
      >;

    const name = String(
      rawData.name ||
      rawData.templateName ||
      rawData.title ||
      'Untitled Template'
    ).trim();

    let owner = null;

    if (
      rawData.businessId
    ) {
      owner =
        await User.findOne({
          businessId:
            rawData.businessId
        }).lean();
    }

    const resolvedBusinessId =
      rawData.businessId ||
      business._id;

    const resolvedAccountId =
      owner?.accountId ?? 0;

    await Template.collection.updateOne(
      {
        _id: raw._id
      },
      {
        $set: {
          businessId:
            resolvedBusinessId,

          accountId:
            resolvedAccountId,

          name,

          description: String(
            rawData.description ||
            ''
          ),

          design:
            normalizeLegacyDesign(
              rawData.design
            ),

          html: String(
            rawData.html ||
            ''
          ),

          previewImage: String(
            rawData.previewImage ||
            ''
          ),

          previewImageName: String(
            rawData.previewImageName ||
            ''
          ),

          status: [
            'draft',
            'published',
            'locked'
          ].includes(
            rawData.status
          )
            ? rawData.status
            : 'draft'
        }
      }
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
            $exists: false
          }
        },
        {
          businessId: null
        }
      ]
    },
    {
      $set: {
        businessId:
          business._id
      }
    }
  );

  console.log(
    '[BRAIN TECHNO] Development bootstrap completed.'
  );
}
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { Business } from '../models/business.model.js';
import { BusinessProfile } from '../models/business-profile.model.js';
import { User } from '../models/user.model.js';

const router = Router();

router.use(requireAuth);

const stepFields: Record<number, string[]> = {
  1: [
    'businessLogo',
    'tagline',
    'aboutBusiness'
  ],
  2: [
    'businessMobileNumber',
    'businessWhatsAppNumber'
  ],
  3: [
    'address',
    'area',
    'city',
    'state',
    'pinCode',
    'googleMapsUrl'
  ],
  4: [
    'businessHoursEnabled',
    'businessHours'
  ],
  5: [
    'socialLinks'
  ],
  6: [
    'coverImage',
    'brandColors'
  ]
};

function hasValue(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (
    value &&
    typeof value === 'object'
  ) {
    return Object.values(
      value as Record<string, unknown>
    ).some(hasValue);
  }

  return value !== null && value !== undefined;
}

function calculateCompletion(
  user: any,
  profile: any
): number {
  const checks = [
    user?.businessName,
    user?.ownerName,
    user?.mobile,
    user?.email,
    user?.businessCategory,
    profile?.businessLogo,
    profile?.tagline,
    profile?.aboutBusiness,
    profile?.businessMobileNumber,
    profile?.businessWhatsAppNumber,
    profile?.address || profile?.city || profile?.state,
    profile?.businessHoursEnabled
      ? profile?.businessHours
      : false,
    profile?.socialLinks?.facebook ||
      profile?.socialLinks?.instagram ||
      profile?.socialLinks?.youtube ||
      profile?.socialLinks?.website,
    profile?.coverImage,
    profile?.brandColors?.primary,
    profile?.brandColors?.secondary
  ];

  return Math.round(
    (
      checks.filter(hasValue).length /
      checks.length
    ) * 100
  );
}

async function resolveProfile(
  userId: string
) {
  const user = await User.findById(userId);

  if (!user) {
    return null;
  }

  const business = user.businessId
    ? await Business.findById(
        user.businessId
      ).lean()
    : null;

  let profile =
    await BusinessProfile.findOne({
      accountId: user._id
    });

  if (!profile) {
    profile =
      await BusinessProfile.create({
        accountId: user._id
      });
  }

  const completion =
    calculateCompletion(
      user,
      profile.toObject()
    );

  if (
    profile.profileCompletion !==
    completion
  ) {
    profile.profileCompletion =
      completion;

    await profile.save();
  }

  return {
    user,
    business,
    profile
  };
}

function responsePayload(
  user: any,
  business: any,
  profile: any
) {
  return {
    account: {
      id:
        String(user._id),

      accountId:
        user.accountId,

      businessName:
        user.businessName ||
        business?.name ||
        '',

      businessSlug:
        business?.slug ||
        '',

      ownerName:
        user.ownerName ||
        '',

      ownerMobileNumber:
        user.mobile ||
        '',

      email:
        user.email ||
        '',

      businessCategory:
        user.businessCategory ||
        ''
    },

    profile:
      profile.toObject({
        versionKey: false
      })
  };
}

router.get(
  '/',
  async (
    req,
    res,
    next
  ) => {
    try {
      const userId =
        req.auth?.userId;

      if (!userId) {
        return res
          .status(401)
          .json({
            message:
              'Authentication required.'
          });
      }

      const data =
        await resolveProfile(
          userId
        );

      if (!data) {
        return res
          .status(404)
          .json({
            message:
              'User not found.'
          });
      }

      return res.json(
        responsePayload(
          data.user,
          data.business,
          data.profile
        )
      );
    } catch (error) {
      return next(error);
    }
  }
);

router.patch(
  '/',
  async (
    req,
    res,
    next
  ) => {
    try {
      const userId =
        req.auth?.userId;

      if (!userId) {
        return res
          .status(401)
          .json({
            message:
              'Authentication required.'
          });
      }

      const step =
        Number(req.body?.step);

      if (
        !Number.isInteger(step) ||
        step < 1 ||
        step > 6
      ) {
        return res
          .status(400)
          .json({
            message:
              'A valid profile step from 1 to 6 is required.'
          });
      }

      const user =
        await User.findById(
          userId
        );

      if (!user) {
        return res
          .status(404)
          .json({
            message:
              'User not found.'
          });
      }

      const update:
        Record<string, unknown> = {};

      for (
        const field of
        stepFields[step]
      ) {
        if (
          Object.prototype.hasOwnProperty.call(
            req.body,
            field
          )
        ) {
          update[field] =
            req.body[field];
        }
      }

      if (
        step === 1 &&
        Object.prototype.hasOwnProperty.call(
          req.body,
          'businessCategory'
        )
      ) {
        const category =
          String(
            req.body.businessCategory ||
            ''
          ).trim();

        if (category) {
          user.businessCategory =
            category;

          await user.save();
        }
      }

      const profile =
        await BusinessProfile.findOneAndUpdate(
          {
            accountId:
              user._id
          },
          {
            $set:
              update,

            $addToSet: {
              completedSteps:
                step
            }
          },
          {
            new: true,
            upsert: true,
            runValidators: true,
            setDefaultsOnInsert: true
          }
        );

      const completedSteps =
        Array.from(
          new Set(
            (
              profile.completedSteps ||
              []
            ).map(
              item =>
                Number(item)
            )
          )
        ).sort(
          (
            a,
            b
          ) =>
            a - b
        );

      const nextIncomplete =
        [
          1,
          2,
          3,
          4,
          5,
          6
        ].find(
          item =>
            !completedSteps.includes(
              item
            )
        );

      profile.currentStep =
        nextIncomplete || 6;

      profile.profileCompletion =
        calculateCompletion(
          user,
          profile.toObject()
        );

      await profile.save();

      const business =
        user.businessId
          ? await Business.findById(
              user.businessId
            ).lean()
          : null;

      return res.json(
        responsePayload(
          user,
          business,
          profile
        )
      );
    } catch (error) {
      return next(error);
    }
  }
);

export default router;

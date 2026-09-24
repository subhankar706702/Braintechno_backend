import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { HydratedDocument } from 'mongoose';

import { Business } from '../models/business.model';
import { Counter } from '../models/counter.model';
import { User } from '../models/user.model';
import { env } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { IUser } from '../interface';

const router = Router();

interface IRegisterRequest {
  ownerName: string;
  mobile: string;
  email: string;
  password: string;
  businessName: string;
  businessCategory?: string;
  businessSlug: string;
}

interface IRegistrationAvailabilityRequest {
  mobile?: string;
  email?: string;
  businessName?: string;
  businessSlug?: string;
}

interface ILoginRequest {
  email: string;
  password: string;
}

const slugify = (value: string): string =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const isValidEmail = (value: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const isValidMobile = (value: string): boolean =>
  /^\d{10}$/.test(value);

const getSlugRecommendations = async (
  requestedSlug: string,
  businessName = ''
): Promise<string[]> => {
  const base =
    slugify(requestedSlug) ||
    slugify(businessName) ||
    'business';

  const year = new Date().getFullYear();

  const candidates = [
    `${base}-official`,
    `${base}-online`,
    `${base}-${year}`,
    `${base}-01`,
    `${base}-02`,
    `${base}-03`,
    `${base}-04`,
    `${base}-05`,
    `${base}-web`,
    `${base}-india`
  ];

  const existing = await Business.find({
    slug: {
      $in: candidates
    }
  })
    .select('slug')
    .lean();

  const used = new Set(
    existing.map((item: any) => String(item.slug || ''))
  );

  const recommendations = candidates
    .filter((slug) => !used.has(slug))
    .slice(0, 4);

  let suffix = 6;

  while (recommendations.length < 4) {
    const slug = `${base}-${String(suffix).padStart(2, '0')}`;
    suffix += 1;

    if (used.has(slug)) {
      continue;
    }

    const exists = await Business.exists({ slug });

    if (!exists) {
      recommendations.push(slug);
    }
  }

  return recommendations;
};

const nextAccountId = async (): Promise<string> => {
  const counter = await Counter.findOneAndUpdate(
    { key: 'accountId' },
    {
      $inc: {
        seq: 1
      }
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );

  return `BT${String(counter.seq).padStart(5, '0')}`;
};

const tokenFor = (
  user: HydratedDocument<IUser>
): string => {
  return jwt.sign(
    {
      sub: String(user._id),
      businessId: user.businessId
        ? String(user.businessId)
        : undefined,
      accountId: user.accountId,
      role: user.role
    },
    env.jwtSecret,
    {
      expiresIn: '7d'
    }
  );
};

const publicUser = (
  user: HydratedDocument<IUser>
) => {
  return {
    id: String(user._id),
    accountId: user.accountId,
    ownerName: user.ownerName,
    mobile: user.mobile,
    email: user.email,
    businessName: user.businessName,
    businessCategory: user.businessCategory,
    businessId: user.businessId
      ? String(user.businessId)
      : undefined,
    role: user.role
  };
};

router.post(
  '/register/availability',
  async (req, res, next) => {
    try {
      const {
        mobile,
        email,
        businessName,
        businessSlug
      } = (req.body || {}) as IRegistrationAvailabilityRequest;

      const normalizedMobile = String(mobile || '').trim();
      const normalizedEmail = String(email || '')
        .trim()
        .toLowerCase();
      const normalizedSlug = slugify(
        String(businessSlug || businessName || '')
      );

      const [mobileExists, emailExists, slugExists] = await Promise.all([
        normalizedMobile
          ? User.exists({ mobile: normalizedMobile })
          : Promise.resolve(null),
        normalizedEmail
          ? User.exists({ email: normalizedEmail })
          : Promise.resolve(null),
        normalizedSlug
          ? Business.exists({ slug: normalizedSlug })
          : Promise.resolve(null)
      ]);

      const mobileAvailable = normalizedMobile
        ? !mobileExists
        : null;
      const emailAvailable = normalizedEmail
        ? !emailExists
        : null;
      const slugAvailable = normalizedSlug
        ? !slugExists
        : null;

      const slugRecommendations =
        normalizedSlug && slugAvailable === false
          ? await getSlugRecommendations(
              normalizedSlug,
              String(businessName || '')
            )
          : [];

      return res.json({
        mobileAvailable,
        emailAvailable,
        slugAvailable,
        normalizedSlug,
        mobileMessage:
          mobileAvailable === false
            ? 'An account already exists with this mobile number.'
            : '',
        emailMessage:
          emailAvailable === false
            ? 'An account already exists with this email address.'
            : '',
        slugMessage:
          slugAvailable === false
            ? 'This business slug is already in use. Choose another one.'
            : '',
        slugRecommendations
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  '/register',
  async (req, res, next) => {
    try {
      const {
        ownerName,
        mobile,
        email,
        password,
        businessName,
        businessCategory,
        businessSlug
      } = (req.body || {}) as Partial<IRegisterRequest>;

      if (
        !ownerName ||
        !mobile ||
        !email ||
        !password ||
        !businessName ||
        !businessSlug
      ) {
        return res.status(400).json({
          type: 'warning',
          message:
            'Owner name, mobile, email, business name, business slug and password are required.'
        });
      }

      if (String(password).length < 8) {
        return res.status(400).json({
          type: 'warning',
          message: 'Password must be at least 8 characters.'
        });
      }

      const normalizedEmail = String(email)
        .toLowerCase()
        .trim();

      const normalizedMobile = String(mobile).trim();
      const normalizedBusinessName = String(businessName).trim();
      const normalizedSlug = slugify(String(businessSlug));

      if (!isValidMobile(normalizedMobile)) {
        return res.status(400).json({
          type: 'warning',
          field: 'mobile',
          message: 'Mobile number must be exactly 10 digits.'
        });
      }

      if (!isValidEmail(normalizedEmail)) {
        return res.status(400).json({
          type: 'warning',
          field: 'email',
          message: 'Please enter a valid email address.'
        });
      }

      if (!normalizedSlug) {
        return res.status(400).json({
          type: 'warning',
          field: 'businessSlug',
          message: 'Business slug is required.'
        });
      }

      const [mobileExists, emailExists, slugExists] = await Promise.all([
        User.exists({ mobile: normalizedMobile }),
        User.exists({ email: normalizedEmail }),
        Business.exists({ slug: normalizedSlug })
      ]);

      if (mobileExists) {
        return res.status(409).json({
          type: 'warning',
          field: 'mobile',
          message: 'An account already exists with this mobile number.'
        });
      }

      if (emailExists) {
        return res.status(409).json({
          type: 'warning',
          field: 'email',
          message: 'An account already exists with this email address.'
        });
      }

      if (slugExists) {
        return res.status(409).json({
          type: 'warning',
          field: 'businessSlug',
          message: 'This business slug is already in use. Choose another one.',
          slugRecommendations: await getSlugRecommendations(
            normalizedSlug,
            normalizedBusinessName
          )
        });
      }

      const business = await Business.create({
        name: normalizedBusinessName,
        slug: normalizedSlug
      });

      try {
        const accountId = await nextAccountId();

        const passwordHash = await bcrypt.hash(
          String(password),
          12
        );

        const user = await User.create({
          accountId,
          ownerName: String(ownerName).trim(),
          mobile: normalizedMobile,
          email: normalizedEmail,
          businessName: normalizedBusinessName,
          businessCategory: String(
            businessCategory || 'General'
          ).trim(),
          passwordHash,
          businessId: business._id,
          role: 'owner'
        });

        business.ownerId = user._id;
        await business.save();

        return res.status(201).json({
          token: tokenFor(user),
          user: publicUser(user)
        });
      } catch (error) {
        await Business.findByIdAndDelete(
          business._id
        );

        throw error;
      }
    } catch (error: any) {
      if (error?.code === 11000) {
        const keyPattern = error?.keyPattern || {};
        const keyValue = error?.keyValue || {};

        if (keyPattern.mobile || keyValue.mobile) {
          return res.status(409).json({
            type: 'warning',
            field: 'mobile',
            message: 'An account already exists with this mobile number.'
          });
        }

        if (keyPattern.email || keyValue.email) {
          return res.status(409).json({
            type: 'warning',
            field: 'email',
            message: 'An account already exists with this email address.'
          });
        }

        if (keyPattern.slug || keyValue.slug) {
          const slug = slugify(
            String(req.body?.businessSlug || req.body?.businessName || '')
          );

          return res.status(409).json({
            type: 'warning',
            field: 'businessSlug',
            message: 'This business slug is already in use. Choose another one.',
            slugRecommendations: await getSlugRecommendations(
              slug,
              String(req.body?.businessName || '')
            )
          });
        }
      }

      return next(error);
    }
  }
);

router.post(
  '/login',
  async (req, res, next) => {
    try {
      const {
        email,
        password
      } = (req.body || {}) as Partial<ILoginRequest>;

      if (!email || !password) {
        return res.status(400).json({
          message: 'Email and password are required.'
        });
      }

      const normalizedEmail = String(email)
        .toLowerCase()
        .trim();

      const user = await User.findOne({
        email: normalizedEmail
      });

      if (!user) {
        return res.status(401).json({
          message: 'Invalid email or password.'
        });
      }

      const passwordMatched = await bcrypt.compare(
        String(password),
        user.passwordHash
      );

      if (!passwordMatched) {
        return res.status(401).json({
          message: 'Invalid email or password.'
        });
      }

      return res.json({
        token: tokenFor(user),
        user: publicUser(user)
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.get(
  '/me',
  requireAuth,
  async (req, res, next) => {
    try {
      const user = await User.findById(
        req.auth!.userId
      );

      if (!user) {
        return res.status(404).json({
          message: 'User not found.'
        });
      }

      return res.json(
        publicUser(user)
      );
    } catch (error) {
      return next(error);
    }
  }
);

export default router;

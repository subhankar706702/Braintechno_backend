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
}

interface ILoginRequest {
  email: string;
  password: string;
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

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
  '/register',
  async (req, res, next) => {
    try {
      const {
        ownerName,
        mobile,
        email,
        password,
        businessName,
        businessCategory
      } = (req.body || {}) as Partial<IRegisterRequest>;

      if (
        !ownerName ||
        !mobile ||
        !email ||
        !password ||
        !businessName
      ) {
        return res.status(400).json({
          message:
            'Owner name, mobile, business name, email and password are required.'
        });
      }

      if (String(password).length < 8) {
        return res.status(400).json({
          message:
            'Password must be at least 8 characters.'
        });
      }

      const normalizedEmail = String(email)
        .toLowerCase()
        .trim();

      const normalizedMobile = String(mobile).trim();

      const existingUser = await User.findOne({
        $or: [
          {
            email: normalizedEmail
          },
          {
            mobile: normalizedMobile
          }
        ]
      });

      if (existingUser) {
        if (existingUser.email === normalizedEmail) {
          return res.status(409).json({
            message:
              'An account already exists with this email.'
          });
        }

        return res.status(409).json({
          message:
            'An account already exists with this mobile number.'
        });
      }

      let slug =
        slugify(String(businessName)) ||
        'brain-techno-business';

      if (await Business.exists({ slug })) {
        slug = `${slug}-${Date.now()
          .toString()
          .slice(-6)}`;
      }

      const business = await Business.create({
        name: String(businessName).trim(),
        slug
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
          businessName: String(businessName).trim(),
          businessCategory:
            String(
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
    } catch (error) {
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
          message:
            'Email and password are required.'
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
          message:
            'Invalid email or password.'
        });
      }

      const passwordMatched =
        await bcrypt.compare(
          String(password),
          user.passwordHash
        );

      if (!passwordMatched) {
        return res.status(401).json({
          message:
            'Invalid email or password.'
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
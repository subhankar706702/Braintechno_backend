import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';

import { User } from '../models/user.model.js';
import {
  SOCIAL_ACCOUNT_STATUSES,
  type SocialAccountStatus
} from '../models/social-account.model.js';
import {
  isSocialPlatform,
  SocialAccountService,
  type SocialAccountScope
} from '../services/social/social-account.service.js';

const cleanText = (value: unknown): string => String(value ?? '').trim();

async function resolveScope(req: Request): Promise<SocialAccountScope | null> {
  const auth = req.auth;
  if (!auth) return null;

  const requestedBusinessId = cleanText(req.query.businessId);
  const businessId =
    auth.role === 'admin' && requestedBusinessId
      ? requestedBusinessId
      : cleanText(auth.businessId);

  if (!businessId || !mongoose.isValidObjectId(businessId)) return null;

  const shouldResolveTargetAccount =
    auth.role === 'admin' && requestedBusinessId && requestedBusinessId !== cleanText(auth.businessId);

  const accountId = shouldResolveTargetAccount
    ? cleanText((await User.findOne({ businessId }).select('accountId').lean())?.accountId)
    : auth.accountId !== '' && auth.accountId !== undefined && auth.accountId !== null
      ? auth.accountId
      : cleanText((await User.findOne({ businessId }).select('accountId').lean())?.accountId);

  if (accountId === '' || accountId === undefined || accountId === null) {
    return null;
  }

  return { businessId, accountId };
}

function validStatus(value: unknown): value is SocialAccountStatus {
  return (SOCIAL_ACCOUNT_STATUSES as readonly unknown[]).includes(value);
}

export class SocialAccountController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const scope = await resolveScope(req);
      if (!scope) {
        return res.status(400).json({
          message: 'A business and account context are required.'
        });
      }

      const items = await SocialAccountService.list(scope);
      return res.json({ items });
    } catch (error) {
      return next(error);
    }
  }

  static async getByPlatform(req: Request, res: Response, next: NextFunction) {
    try {
      const scope = await resolveScope(req);
      if (!scope) {
        return res.status(400).json({
          message: 'A business and account context are required.'
        });
      }

      const platform = cleanText(req.params.platform);
      if (!isSocialPlatform(platform)) {
        return res.status(400).json({ message: 'Invalid social platform.' });
      }

      const item = await SocialAccountService.getByPlatform(scope, platform);
      if (!item) {
        return res.json({
          id: '',
          platform,
          accountName: '',
          pageName: '',
          externalAccountId: '',
          status: 'Not Connected',
          tokenExpiresAt: null,
          connected: false
        });
      }

      return res.json(item);
    } catch (error) {
      return next(error);
    }
  }

  static async connect(req: Request, res: Response, next: NextFunction) {
    try {
      const scope = await resolveScope(req);
      if (!scope) {
        return res.status(400).json({
          message: 'A business and account context are required.'
        });
      }

      const platform = cleanText(req.body?.platform);
      const externalAccountId = cleanText(req.body?.externalAccountId);

      if (!isSocialPlatform(platform)) {
        return res.status(400).json({ message: 'Invalid social platform.' });
      }

      if (!externalAccountId) {
        return res.status(400).json({
          message: 'External account id is required.'
        });
      }

      if (externalAccountId.length > 300) {
        return res.status(400).json({
          message: 'External account id cannot exceed 300 characters.'
        });
      }

      const item = await SocialAccountService.connect(scope, {
        platform,
        accountName: req.body?.accountName,
        pageName: req.body?.pageName,
        externalAccountId
      });

      return res.status(200).json(item);
    } catch (error) {
      return next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const scope = await resolveScope(req);
      if (!scope) {
        return res.status(400).json({
          message: 'A business and account context are required.'
        });
      }

      const status = req.body?.status;
      if (status !== undefined && !validStatus(status)) {
        return res.status(400).json({ message: 'Invalid social account status.' });
      }

      const tokenExpiresAtValue = req.body?.tokenExpiresAt;
      let tokenExpiresAt: Date | null | undefined;

      if (tokenExpiresAtValue !== undefined) {
        if (tokenExpiresAtValue === null || tokenExpiresAtValue === '') {
          tokenExpiresAt = null;
        } else {
          const parsed = new Date(tokenExpiresAtValue);
          if (Number.isNaN(parsed.getTime())) {
            return res.status(400).json({ message: 'Invalid token expiry date.' });
          }
          tokenExpiresAt = parsed;
        }
      }

      const item = await SocialAccountService.update(scope, req.params.id, {
        accountName: req.body?.accountName,
        pageName: req.body?.pageName,
        externalAccountId: req.body?.externalAccountId,
        status,
        tokenExpiresAt
      });

      if (!item) {
        return res.status(404).json({ message: 'Social account not found.' });
      }

      return res.json(item);
    } catch (error: any) {
      if (error?.status) {
        return res.status(error.status).json({ message: error.message });
      }
      return next(error);
    }
  }

  static async disconnect(req: Request, res: Response, next: NextFunction) {
    try {
      const scope = await resolveScope(req);
      if (!scope) {
        return res.status(400).json({
          message: 'A business and account context are required.'
        });
      }

      const item = await SocialAccountService.disconnect(scope, req.params.id);
      if (!item) {
        return res.status(404).json({ message: 'Social account not found.' });
      }

      return res.json(item);
    } catch (error: any) {
      if (error?.status) {
        return res.status(error.status).json({ message: error.message });
      }
      return next(error);
    }
  }
}

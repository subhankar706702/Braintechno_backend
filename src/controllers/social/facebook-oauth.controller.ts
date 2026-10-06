import type { NextFunction, Request, Response } from 'express';

import { User } from '../../models/user.model.js';
import { FacebookOAuthService } from '../../services/social/oauth/facebook-oauth.service.js';

const clean = (value: unknown): string => String(value ?? '').trim();

function frontendUrl(path: string): string {
  const base = String(process.env.FRONTEND_URL || 'http://localhost:4200')
    .trim()
    .replace(/\/$/, '');

  return `${base}${path}`;
}

async function resolveScope(req: Request): Promise<{
  businessId: string;
  accountId: string | number;
} | null> {
  const auth = req.auth;
  if (!auth) return null;

  const businessId = clean(auth.businessId);
  if (!businessId) return null;

  const accountId =
    auth.accountId !== undefined && auth.accountId !== null && clean(auth.accountId)
      ? auth.accountId
      : clean((await User.findOne({ businessId }).select('accountId').lean())?.accountId);

  if (accountId === '' || accountId === undefined || accountId === null) {
    return null;
  }

  return { businessId, accountId };
}

export class FacebookOAuthController {
  static async start(req: Request, res: Response, next: NextFunction) {
    try {
      const scope = await resolveScope(req);
      if (!scope) {
        return res.status(400).json({
          message: 'A business and account context are required.',
        });
      }

      const url = await FacebookOAuthService.createAuthorizationUrl(scope);
      return res.redirect(url);
    } catch (error) {
      return next(error);
    }
  }

  static async callback(req: Request, res: Response, next: NextFunction) {
    try {
      const code = clean(req.query.code);
      const state = clean(req.query.state);
      const oauthError = clean(req.query.error);

      if (oauthError) {
        const reason = encodeURIComponent(
          clean(req.query.error_description) || 'Facebook authorization was cancelled.'
        );
        return res.redirect(
          frontendUrl(`/app/social/connected-accounts?social=facebook&status=error&message=${reason}`)
        );
      }

      if (!code || !state) {
        const reason = encodeURIComponent('Facebook OAuth callback is missing code or state.');
        return res.redirect(
          frontendUrl(`/app/social/connected-accounts?social=facebook&status=error&message=${reason}`)
        );
      }

      const result = await FacebookOAuthService.handleCallback(code, state);

      if (result.type === 'selection_required' && result.selection) {
        const payload = encodeURIComponent(
          JSON.stringify(result.selection.pages)
        );

        return res.redirect(
          frontendUrl(
            `/app/social/connected-accounts?social=facebook&status=select-page&selectionToken=${encodeURIComponent(result.selection.selectionToken)}&pages=${payload}`
          )
        );
      }

      return res.redirect(
        frontendUrl(
          `/app/social/connected-accounts?social=facebook&status=connected`
        )
      );
    } catch (error: any) {
      const reason = encodeURIComponent(
        clean(error?.message) || 'Facebook connection failed.'
      );

      return res.redirect(
        frontendUrl(
          `/app/social/connected-accounts?social=facebook&status=error&message=${reason}`
        )
      );
    }
  }

  static async selectPage(req: Request, res: Response, next: NextFunction) {
    try {
      const token = clean(req.body?.selectionToken);
      const pageId = clean(req.body?.pageId);

      if (!token || !pageId) {
        return res.status(400).json({
          message: 'Selection token and page id are required.',
        });
      }

      const page = await FacebookOAuthService.selectPage(token, pageId);

      return res.json({
        platform: 'Facebook',
        page,
        status: 'Connected',
      });
    } catch (error) {
      return next(error);
    }
  }
}

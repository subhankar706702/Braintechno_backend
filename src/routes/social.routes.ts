import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { User } from '../models/user.model';
import {
  SOCIAL_PLATFORMS,
  SocialAccount,
} from '../models/social-account.model';

import { env } from '../config/env';
import { createFacebookOAuthStart, handleFacebookOAuthCallback, getFacebookPageSelection, selectFacebookPage } from '../services/social/oauth/facebook-oauth.service';

const router = Router();

const clean = (value: unknown): string => String(value ?? '').trim();

const frontendCallback = (status: 'connected' | 'error', message?: string): string => {
  const url = new URL(
    '/app/social/connected-accounts',
    env.frontendUrl
  );
  url.searchParams.set('social', 'facebook');
  url.searchParams.set('status', status);

  if (message) {
    url.searchParams.set('message', message.slice(0, 300));
  }

  return url.toString();
};

router.get('/accounts', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.auth!.userId)
      .select('businessId accountId')
      .lean();

    if (!user?.businessId) {
      return res.status(409).json({
        message: 'Your business account is not configured.',
      });
    }

    const rows = await SocialAccount.find({
      userId: req.auth!.userId,
      businessId: user.businessId,
    })
      .select('platform accountName pageName status tokenExpiresAt externalAccountId')
      .sort({ platform: 1 })
      .lean();

    const response = SOCIAL_PLATFORMS.map((platform) => {
      const row = rows.find((item) => item.platform === platform);

      return {
        id: row ? String(row._id) : '',
        platform,
        accountName: row?.accountName || '',
        pageName: row?.pageName || '',
        status: row?.status || 'Not Connected',
        tokenExpiresAt: row?.tokenExpiresAt || null,
        externalAccountId: row?.externalAccountId || '',
      };
    });

    return res.json(response);
  } catch (error) {
    return next(error);
  }
});

router.post('/oauth/facebook/start', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.auth!.userId)
      .select('businessId accountId')
      .lean();

    if (!user?.businessId) {
      return res.status(409).json({
        message: 'Your business account is not configured.',
      });
    }

    const authorizationUrl = await createFacebookOAuthStart({
      userId: String(req.auth!.userId),
      businessId: String(user.businessId),
      accountId: user.accountId,
    });

    return res.json({ authorizationUrl });
  } catch (error) {
    return next(error);
  }
});

router.get('/oauth/facebook/callback', async (req, res) => {
  const code = clean(req.query.code);
  const state = clean(req.query.state);
  const oauthError = clean(req.query.error_description || req.query.error);

  if (oauthError) {
    return res.redirect(frontendCallback('error', oauthError));
  }

  if (!code || !state) {
    return res.redirect(
      frontendCallback('error', 'Facebook did not return a valid OAuth response.')
    );
  }

  try {
    const result = await handleFacebookOAuthCallback(code, state);

    if (result.selectionToken) {
      const url = new URL('/app/social/connected-accounts', env.frontendUrl);
      url.searchParams.set('social', 'facebook');
      url.searchParams.set('status', 'select_page');
      url.searchParams.set('selectionToken', result.selectionToken);
      return res.redirect(url.toString());
    }

    return res.redirect(frontendCallback('connected'));
  } catch (error: any) {
    console.error('[SOCIAL][FACEBOOK OAUTH]', error);
    return res.redirect(
      frontendCallback(
        'error',
        error?.message || 'Facebook connection failed.'
      )
    );
  }
});


router.get('/oauth/facebook/pages', requireAuth, async (req, res, next) => {
  try {
    const selectionToken = clean(req.query.selectionToken);
    if (!selectionToken) {
      return res.status(400).json({ message: 'Facebook Page selection token is required.' });
    }

    const pages = await getFacebookPageSelection(
      selectionToken,
      String(req.auth!.userId)
    );

    return res.json({ pages });
  } catch (error) {
    return next(error);
  }
});

router.post('/oauth/facebook/pages/select', requireAuth, async (req, res, next) => {
  try {
    const selectionToken = clean(req.body?.selectionToken);
    const pageId = clean(req.body?.pageId);

    if (!selectionToken || !pageId) {
      return res.status(400).json({
        message: 'Facebook Page selection token and page ID are required.',
      });
    }

    await selectFacebookPage(
      selectionToken,
      String(req.auth!.userId),
      pageId
    );

    return res.json({ message: 'Facebook Page connected successfully.' });
  } catch (error) {
    return next(error);
  }
});

router.delete('/accounts/:id', requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.auth!.userId)
      .select('businessId')
      .lean();

    if (!user?.businessId) {
      return res.status(409).json({
        message: 'Your business account is not configured.',
      });
    }

    const account = await SocialAccount.findOne({
      _id: req.params.id,
      userId: req.auth!.userId,
      businessId: user.businessId,
    });

    if (!account) {
      return res.status(404).json({
        message: 'Social account not found.',
      });
    }

    account.status = 'Not Connected';
    account.accessTokenEncrypted = '';
    account.tokenExpiresAt = null;
    await account.save();

    return res.json({ message: 'Social account disconnected.' });
  } catch (error) {
    return next(error);
  }
});

export default router;

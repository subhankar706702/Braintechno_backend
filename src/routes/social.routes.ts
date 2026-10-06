import { Router } from 'express';

import { requireAuth } from '../middleware/auth';

import { User } from '../models/user.model';

import {
  SOCIAL_PLATFORMS,
  SocialAccount,
} from '../models/social-account.model';

import {
  createFacebookOAuthStart,
  handleFacebookOAuthCallback,
  getFacebookPageSelection,
  selectFacebookPage,
} from '../services/social/oauth/facebook-oauth.service';

import {
  createInstagramOAuthStart,
  handleInstagramOAuthCallback,
} from '../services/social/oauth/instagram-oauth.service';

import {
  createLinkedInOAuthStart,
  handleLinkedInOAuthCallback,
} from '../services/social/oauth/linkedin-oauth.service';

import { env } from '../config/env';

const router = Router();

const clean = (
  value: unknown,
): string =>
  String(value ?? '').trim();

const frontendCallback = (
  status:
    | 'connected'
    | 'error',

  message?: string,

  social:
    | 'facebook'
    | 'instagram'
    | 'linkedin' =
    'facebook',
): string => {
  const url =
    new URL(
      '/app/social/connected-accounts',
      env.frontendUrl,
    );

  url.searchParams.set(
    'social',
    social,
  );

  url.searchParams.set(
    'status',
    status,
  );

  if (message) {
    url.searchParams.set(
      'message',
      message.slice(0, 300),
    );
  }

  return url.toString();
};


/*
 * GET CONNECTED ACCOUNTS
 */
router.get(
  '/accounts',
  requireAuth,
  async (
    req,
    res,
    next,
  ) => {
    try {
      const user =
        await User.findById(
          req.auth!.userId,
        )
          .select(
            'businessId accountId',
          )
          .lean();

      if (!user?.businessId) {
        return res.status(409).json({
          message:
            'Your business account is not configured.',
        });
      }

      const rows =
        await SocialAccount.find({
          userId:
            req.auth!.userId,

          businessId:
            user.businessId,
        })
          .select(
            'platform accountName pageName status tokenExpiresAt externalAccountId',
          )
          .sort({
            platform: 1,
          })
          .lean();

      const response =
        SOCIAL_PLATFORMS.map(
          platform => {
            const row =
              rows.find(
                item =>
                  item.platform ===
                  platform,
              );

            return {
              id:
                row
                  ? String(row._id)
                  : '',

              platform,

              accountName:
                row?.accountName ||
                '',

              pageName:
                row?.pageName ||
                '',

              status:
                row?.status ||
                'Not Connected',

              tokenExpiresAt:
                row?.tokenExpiresAt ||
                null,

              externalAccountId:
                row?.externalAccountId ||
                '',
            };
          },
        );

      return res.json(
        response,
      );
    } catch (error) {
      return next(error);
    }
  },
);


/*
 * FACEBOOK OAUTH START
 */
router.post(
  '/oauth/facebook/start',
  requireAuth,
  async (
    req,
    res,
    next,
  ) => {
    try {
      const user =
        await User.findById(
          req.auth!.userId,
        )
          .select(
            'businessId accountId',
          )
          .lean();

      if (!user?.businessId) {
        return res.status(409).json({
          message:
            'Your business account is not configured.',
        });
      }

      const authorizationUrl =
        await createFacebookOAuthStart({
          userId:
            req.auth!.userId,

          businessId:
            String(user.businessId),

          accountId:
            user.accountId,
        });

      return res.json({
        authorizationUrl,
      });
    } catch (error) {
      return next(error);
    }
  },
);


/*
 * FACEBOOK OAUTH CALLBACK
 */
router.get(
  '/oauth/facebook/callback',
  async (
    req,
    res,
  ) => {
    const code =
      clean(req.query.code);

    const state =
      clean(req.query.state);

    const error =
      clean(req.query.error);

    const errorDescription =
      clean(
        req.query.error_description,
      );

    if (error) {
      return res.redirect(
        frontendCallback(
          'error',

          errorDescription ||
            error,

          'facebook',
        ),
      );
    }

    if (!code || !state) {
      return res.redirect(
        frontendCallback(
          'error',

          'Facebook OAuth code or state is missing.',

          'facebook',
        ),
      );
    }

    try {
      const result =
        await handleFacebookOAuthCallback(
          code,
          state,
        );

      if (
        result.selectionToken
      ) {
        const url =
          new URL(
            '/app/social/connected-accounts',
            env.frontendUrl,
          );

        url.searchParams.set(
          'social',
          'facebook',
        );

        url.searchParams.set(
          'status',
          'select_page',
        );

        url.searchParams.set(
          'selectionToken',
          result.selectionToken,
        );

        return res.redirect(
          url.toString(),
        );
      }

      return res.redirect(
        frontendCallback(
          'connected',
          'Facebook connected successfully.',
          'facebook',
        ),
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Facebook connection failed.';

      return res.redirect(
        frontendCallback(
          'error',
          message,
          'facebook',
        ),
      );
    }
  },
);


/*
 * FACEBOOK PAGE SELECTION
 */
router.get(
  '/oauth/facebook/pages',
  requireAuth,
  async (
    req,
    res,
    next,
  ) => {
    try {
      const selectionToken =
        clean(
          req.query.selectionToken,
        );

      if (!selectionToken) {
        return res.status(400).json({
          message:
            'Selection token is required.',
        });
      }

      const result =
        await getFacebookPageSelection(
          selectionToken,
          req.auth!.userId,
        );

      return res.json(
        result,
      );
    } catch (error) {
      return next(error);
    }
  },
);


/*
 * FACEBOOK PAGE SELECT
 */
router.post(
  '/oauth/facebook/pages/select',
  requireAuth,
  async (
    req,
    res,
    next,
  ) => {
    try {
      const selectionToken =
        clean(
          req.body?.selectionToken,
        );

      const pageId =
        clean(
          req.body?.pageId,
        );

      if (
        !selectionToken ||
        !pageId
      ) {
        return res.status(400).json({
          message:
            'Selection token and page ID are required.',
        });
      }

      await selectFacebookPage(
        selectionToken,
        pageId,
        req.auth!.userId,
      );

      return res.json({
        message:
          'Facebook Page connected successfully.',
      });
    } catch (error) {
      return next(error);
    }
  },
);


/*
 * INSTAGRAM OAUTH START
 */
router.post(
  '/oauth/instagram/start',
  requireAuth,
  async (
    req,
    res,
    next,
  ) => {
    try {
      const user =
        await User.findById(
          req.auth!.userId,
        )
          .select(
            'businessId accountId',
          )
          .lean();

      if (!user?.businessId) {
        return res.status(409).json({
          message:
            'Your business account is not configured.',
        });
      }

      const authorizationUrl =
        await createInstagramOAuthStart({
          userId:
            req.auth!.userId,

          businessId:
            String(user.businessId),

          accountId:
            user.accountId,
        });

      return res.json({
        authorizationUrl,
      });
    } catch (error) {
      return next(error);
    }
  },
);


/*
 * INSTAGRAM OAUTH CALLBACK
 */
router.get(
  '/oauth/instagram/callback',
  async (
    req,
    res,
  ) => {
    const code =
      clean(req.query.code);

    const state =
      clean(req.query.state);

    const error =
      clean(req.query.error);

    const errorDescription =
      clean(
        req.query.error_description,
      );

    if (error) {
      return res.redirect(
        frontendCallback(
          'error',

          errorDescription ||
            error,

          'instagram',
        ),
      );
    }

    if (!code || !state) {
      return res.redirect(
        frontendCallback(
          'error',

          'Instagram OAuth code or state is missing.',

          'instagram',
        ),
      );
    }

    try {
      await handleInstagramOAuthCallback(
        code,
        state,
      );

      return res.redirect(
        frontendCallback(
          'connected',

          'Instagram connected successfully.',

          'instagram',
        ),
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Instagram connection failed.';

      return res.redirect(
        frontendCallback(
          'error',

          message,

          'instagram',
        ),
      );
    }
  },
);


/*
 * LINKEDIN OAUTH START
 */
router.post(
  '/oauth/linkedin/start',
  requireAuth,
  async (
    req,
    res,
    next,
  ) => {
    try {
      const user =
        await User.findById(
          req.auth!.userId,
        )
          .select(
            'businessId accountId',
          )
          .lean();

      if (!user?.businessId) {
        return res.status(409).json({
          message:
            'Your business account is not configured.',
        });
      }

      const authorizationUrl =
        await createLinkedInOAuthStart({
          userId:
            req.auth!.userId,

          businessId:
            String(user.businessId),

          accountId:
            user.accountId,
        });

      return res.json({
        authorizationUrl,
      });
    } catch (error) {
      return next(error);
    }
  },
);


/*
 * LINKEDIN OAUTH CALLBACK
 *
 * Public route.
 *
 * LinkedIn redirects the browser here,
 * therefore JWT authentication is NOT used
 * on this callback.
 *
 * OAuth state authenticates the flow.
 */
router.get(
  '/oauth/linkedin/callback',
  async (
    req,
    res,
  ) => {
    const code =
      clean(req.query.code);

    const state =
      clean(req.query.state);

    const error =
      clean(req.query.error);

    const errorDescription =
      clean(
        req.query.error_description,
      );

    if (error) {
      return res.redirect(
        frontendCallback(
          'error',

          errorDescription ||
            error,

          'linkedin',
        ),
      );
    }

    if (!code || !state) {
      return res.redirect(
        frontendCallback(
          'error',

          'LinkedIn OAuth code or state is missing.',

          'linkedin',
        ),
      );
    }

    try {
      await handleLinkedInOAuthCallback(
        code,
        state,
      );

      return res.redirect(
        frontendCallback(
          'connected',

          'LinkedIn connected successfully.',

          'linkedin',
        ),
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'LinkedIn connection failed.';

      return res.redirect(
        frontendCallback(
          'error',

          message,

          'linkedin',
        ),
      );
    }
  },
);


/*
 * DISCONNECT SOCIAL ACCOUNT
 */
router.delete(
  '/accounts/:id',
  requireAuth,
  async (
    req,
    res,
    next,
  ) => {
    try {
      const user =
        await User.findById(
          req.auth!.userId,
        )
          .select(
            'businessId',
          )
          .lean();

      if (!user?.businessId) {
        return res.status(409).json({
          message:
            'Your business account is not configured.',
        });
      }

      const id =
        clean(req.params.id);

      if (!id) {
        return res.status(400).json({
          message:
            'Social account ID is required.',
        });
      }

      const account =
        await SocialAccount.findOne({
          _id: id,

          userId:
            req.auth!.userId,

          businessId:
            user.businessId,
        });

      if (!account) {
        return res.status(404).json({
          message:
            'Social account not found.',
        });
      }

      await SocialAccount.deleteOne({
        _id: account._id,
      });

      return res.json({
        message:
          'Social account disconnected successfully.',
      });
    } catch (error) {
      return next(error);
    }
  },
);


export default router;
import crypto from 'node:crypto';

import { env } from '../../../config/env';
import { User } from '../../../models/user.model';
import { SocialAccount } from '../../../models/social-account.model';
import { SocialOAuthState } from '../../../models/social-oauth-state.model';
import { encryptSocialToken } from '../../../utils/social/token-crypto';

interface InstagramTokenResponse {
  access_token?: string;
  user_id?: string;
  expires_in?: number;
  permissions?: string;

  error_message?: string;
  error_type?: string;
  code?: number;

  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
}

interface InstagramProfileResponse {
  id?: string;
  username?: string;
  name?: string;

  profile_picture_url?: string;
  biography?: string;

  followers_count?: number;
  follows_count?: number;
  media_count?: number;

  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
}

const INSTAGRAM_AUTHORIZE_URL =
  'https://www.instagram.com/oauth/authorize';

const INSTAGRAM_TOKEN_URL =
  'https://api.instagram.com/oauth/access_token';

const INSTAGRAM_GRAPH_URL =
  'https://graph.instagram.com';

const hashValue = (
  value: string,
): string => {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
};

const getInstagramErrorMessage = (
  body: InstagramTokenResponse | InstagramProfileResponse,
): string => {
  if (body?.error?.message) {
    return body.error.message;
  }

  if ('error_message' in body && body.error_message) {
    return body.error_message;
  }

  return 'Instagram API request failed.';
};

const assertInstagramConfigured = (): void => {
  if (
    !env.metaAppId ||
    !env.metaAppSecret ||
    !env.metaInstagramRedirectUri
  ) {
    throw Object.assign(
      new Error(
        'Instagram OAuth is not configured. Set META_APP_ID, META_APP_SECRET and META_INSTAGRAM_REDIRECT_URI in the backend .env.',
      ),
      {
        status: 503,
      },
    );
  }

  if (!env.socialTokenEncryptionKey) {
    throw Object.assign(
      new Error(
        'SOCIAL_TOKEN_ENCRYPTION_KEY is not configured.',
      ),
      {
        status: 503,
      },
    );
  }
};

export const createInstagramOAuthStart =
  async (input: {
    userId: string;
    businessId: string;
    accountId?: string | number;
  }): Promise<string> => {
    assertInstagramConfigured();

    const rawState =
      crypto.randomBytes(32).toString('base64url');

    const stateHash =
      hashValue(rawState);

    await SocialOAuthState.create({
      stateHash,

      userId: input.userId,
      businessId: input.businessId,

      provider: 'instagram',

      expiresAt:
        new Date(
          Date.now() +
          10 * 60 * 1000,
        ),
    });

    const params =
      new URLSearchParams({
        client_id: env.metaAppId,

        redirect_uri:
          env.metaInstagramRedirectUri,

        response_type: 'code',

        scope:
          env.instagramOAuthScopes,

        state: rawState,
      });

    return (
      `${INSTAGRAM_AUTHORIZE_URL}?` +
      params.toString()
    );
  };

const exchangeCodeForShortLivedToken =
  async (
    code: string,
  ): Promise<InstagramTokenResponse> => {
    const body =
      new URLSearchParams({
        client_id:
          env.metaAppId,

        client_secret:
          env.metaAppSecret,

        grant_type:
          'authorization_code',

        redirect_uri:
          env.metaInstagramRedirectUri,

        code,
      });

    const response =
      await fetch(
        INSTAGRAM_TOKEN_URL,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/x-www-form-urlencoded',
          },

          body,
        },
      );

    const data =
      (await response.json()) as InstagramTokenResponse;

    if (
      !response.ok ||
      !data.access_token ||
      !data.user_id
    ) {
      throw new Error(
        getInstagramErrorMessage(data),
      );
    }

    return data;
  };

const exchangeForLongLivedToken =
  async (
    shortLivedToken: string,
  ): Promise<InstagramTokenResponse> => {
    const params =
      new URLSearchParams({
        grant_type:
          'ig_exchange_token',

        client_secret:
          env.metaAppSecret,

        access_token:
          shortLivedToken,
      });

    const response =
      await fetch(
        `${INSTAGRAM_GRAPH_URL}/access_token?${params.toString()}`,
      );

    const data =
      (await response.json()) as InstagramTokenResponse;

    if (
      !response.ok ||
      !data.access_token
    ) {
      throw new Error(
        getInstagramErrorMessage(data),
      );
    }

    return data;
  };

const getInstagramProfile =
  async (
    instagramUserId: string,
    accessToken: string,
  ): Promise<InstagramProfileResponse> => {
    const params =
      new URLSearchParams({
        fields:
          [
            'id',
            'username',
            'name',
            'profile_picture_url',
            'biography',
            'followers_count',
            'follows_count',
            'media_count',
          ].join(','),

        access_token:
          accessToken,
      });

    const response =
      await fetch(
        `${INSTAGRAM_GRAPH_URL}/${encodeURIComponent(
          instagramUserId,
        )}?${params.toString()}`,
      );

    const data =
      (await response.json()) as InstagramProfileResponse;

    if (
      !response.ok ||
      !data.id
    ) {
      throw new Error(
        getInstagramErrorMessage(data),
      );
    }

    return data;
  };

const saveInstagramAccount =
  async (
    userId: string,
    businessId: string,
    profile: InstagramProfileResponse,
    accessToken: string,
    expiresIn?: number,
  ): Promise<void> => {
    if (!profile.id) {
      throw new Error(
        'Instagram account ID was not returned.',
      );
    }

    const user =
      await User.findById(userId)
        .select('accountId')
        .lean();

    const tokenExpiresAt =
      typeof expiresIn === 'number' &&
      expiresIn > 0
        ? new Date(
            Date.now() +
            expiresIn * 1000,
          )
        : null;

    await SocialAccount.findOneAndUpdate(
      {
        businessId,
        platform: 'Instagram',
      },

      {
        $set: {
          userId,

          businessId,

          accountId:
            user?.accountId
              ? String(user.accountId)
              : '',

          platform:
            'Instagram',

          externalAccountId:
            profile.id,

          accountName:
            profile.name ||
            profile.username ||
            'Instagram Account',

          pageName:
            profile.username
              ? `@${profile.username}`
              : '',

          accessTokenEncrypted:
            encryptSocialToken(
              accessToken,
            ),

          tokenExpiresAt,

          status:
            'Connected',

          metadata: {
            username:
              profile.username || '',

            profilePictureUrl:
              profile.profile_picture_url || '',

            biography:
              profile.biography || '',

            followersCount:
              profile.followers_count ?? null,

            followsCount:
              profile.follows_count ?? null,

            mediaCount:
              profile.media_count ?? null,

            provider:
              'instagram_login',
          },
        },
      },

      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );
  };

export const handleInstagramOAuthCallback =
  async (
    code: string,
    rawState: string,
  ): Promise<void> => {
    assertInstagramConfigured();

    const stateHash =
      hashValue(rawState);

    /*
     * Atomic state validation.
     *
     * This prevents the same OAuth state
     * from being used twice.
     */
    const state =
      await SocialOAuthState.findOneAndUpdate(
        {
          stateHash,

          provider:
            'instagram',

          usedAt:
            null,

          expiresAt: {
            $gt: new Date(),
          },
        },

        {
          $set: {
            usedAt:
              new Date(),
          },
        },

        {
          new: true,
        },
      );

    if (!state) {
      throw Object.assign(
        new Error(
          'Instagram OAuth state is invalid, expired, or already used.',
        ),
        {
          status: 400,
        },
      );
    }

    try {
      const shortLivedToken =
        await exchangeCodeForShortLivedToken(
          code,
        );

      const longLivedToken =
        await exchangeForLongLivedToken(
          shortLivedToken.access_token!,
        );

      const instagramUserId =
        longLivedToken.user_id ||
        shortLivedToken.user_id;

      if (!instagramUserId) {
        throw new Error(
          'Instagram user ID was not returned.',
        );
      }

      const profile =
        await getInstagramProfile(
          instagramUserId,
          longLivedToken.access_token!,
        );

      await saveInstagramAccount(
        String(state.userId),

        String(state.businessId),

        profile,

        longLivedToken.access_token!,

        longLivedToken.expires_in,
      );

      await SocialOAuthState.deleteOne({
        _id: state._id,
      });
    } catch (error) {
      await SocialOAuthState.deleteOne({
        _id: state._id,
      });

      throw error;
    }
  };
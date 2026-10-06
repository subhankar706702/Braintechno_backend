import crypto from 'node:crypto';

import { env } from '../../../config/env';
import { User } from '../../../models/user.model';
import { SocialAccount } from '../../../models/social-account.model';
import { SocialOAuthState } from '../../../models/social-oauth-state.model';
import { encryptSocialToken } from '../../../utils/social/token-crypto';

interface LinkedInTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;

  error?: string;
  error_description?: string;
}

interface LinkedInUserInfoResponse {
  sub?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: {
    country?: string;
    language?: string;
  };

  email?: string;
  email_verified?: boolean;
}

const LINKEDIN_AUTHORIZE_URL =
  'https://www.linkedin.com/oauth/v2/authorization';

const LINKEDIN_TOKEN_URL =
  'https://www.linkedin.com/oauth/v2/accessToken';

const LINKEDIN_USERINFO_URL =
  'https://api.linkedin.com/v2/userinfo';

const hashValue = (value: string): string => {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
};

const getLinkedInErrorMessage = (
  body: LinkedInTokenResponse | LinkedInUserInfoResponse,
): string => {
  if ('error_description' in body && body.error_description) {
    return body.error_description;
  }

  if ('error' in body && body.error) {
    return body.error;
  }

  return 'LinkedIn API request failed.';
};

const assertLinkedInConfigured = (): void => {
  if (
    !env.linkedinClientId ||
    !env.linkedinClientSecret ||
    !env.linkedinRedirectUri
  ) {
    throw Object.assign(
      new Error(
        'LinkedIn OAuth is not configured. Set LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET and LINKEDIN_REDIRECT_URI in the backend .env.',
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

export const createLinkedInOAuthStart = async (input: {
  userId: string;
  businessId: string;
  accountId?: string | number;
}): Promise<string> => {
  assertLinkedInConfigured();

  const rawState =
    crypto.randomBytes(32).toString('base64url');

  const stateHash = hashValue(rawState);

  await SocialOAuthState.create({
    stateHash,

    userId: input.userId,

    businessId: input.businessId,

    provider: 'linkedin',

    expiresAt: new Date(
      Date.now() + 10 * 60 * 1000,
    ),
  });

  const params = new URLSearchParams({
    response_type: 'code',

    client_id:
      env.linkedinClientId,

    redirect_uri:
      env.linkedinRedirectUri,

    state: rawState,

    scope:
      env.linkedinOAuthScopes,
  });

  return (
    `${LINKEDIN_AUTHORIZE_URL}?` +
    params.toString()
  );
};

const exchangeCodeForToken = async (
  code: string,
): Promise<LinkedInTokenResponse> => {
  const body =
    new URLSearchParams({
      grant_type:
        'authorization_code',

      code,

      client_id:
        env.linkedinClientId,

      client_secret:
        env.linkedinClientSecret,

      redirect_uri:
        env.linkedinRedirectUri,
    });

  const response = await fetch(
    LINKEDIN_TOKEN_URL,
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
    (await response.json()) as LinkedInTokenResponse;

  if (
    !response.ok ||
    !data.access_token
  ) {
    throw Object.assign(
      new Error(
        getLinkedInErrorMessage(data),
      ),
      {
        status: 400,
      },
    );
  }

  return data;
};

const getLinkedInUserInfo = async (
  accessToken: string,
): Promise<LinkedInUserInfoResponse> => {
  const response = await fetch(
    LINKEDIN_USERINFO_URL,
    {
      method: 'GET',

      headers: {
        Authorization:
          `Bearer ${accessToken}`,

        Accept:
          'application/json',
      },
    },
  );

  const data =
    (await response.json()) as LinkedInUserInfoResponse;

  if (
    !response.ok ||
    !data.sub
  ) {
    throw Object.assign(
      new Error(
        getLinkedInErrorMessage(data),
      ),
      {
        status: 400,
      },
    );
  }

  return data;
};

const saveLinkedInAccount = async (
  userId: string,
  businessId: string,
  profile: LinkedInUserInfoResponse,
  accessToken: string,
  expiresIn?: number,
  refreshToken?: string,
  refreshTokenExpiresIn?: number,
): Promise<void> => {
  if (!profile.sub) {
    throw new Error(
      'LinkedIn profile ID was not returned.',
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

  const refreshTokenExpiresAt =
    typeof refreshTokenExpiresIn === 'number' &&
    refreshTokenExpiresIn > 0
      ? new Date(
          Date.now() +
          refreshTokenExpiresIn * 1000,
        )
      : null;

  const accountName =
    profile.name ||
    [
      profile.given_name,
      profile.family_name,
    ]
      .filter(Boolean)
      .join(' ') ||
    'LinkedIn Account';

  await SocialAccount.findOneAndUpdate(
    {
      businessId,

      platform:
        'LinkedIn',
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
          'LinkedIn',

        externalAccountId:
          profile.sub,

        accountName,

        pageName:
          accountName,

        accessTokenEncrypted:
          encryptSocialToken(
            accessToken,
          ),

        tokenExpiresAt,

        status:
          'Connected',

        metadata: {
          provider:
            'linkedin',

          name:
            profile.name || '',

          givenName:
            profile.given_name || '',

          familyName:
            profile.family_name || '',

          picture:
            profile.picture || '',

          email:
            profile.email || '',

          emailVerified:
            profile.email_verified ?? false,

          locale:
            profile.locale || null,

          refreshTokenEncrypted:
            refreshToken
              ? encryptSocialToken(
                  refreshToken,
                )
              : '',

          refreshTokenExpiresAt,
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

export const handleLinkedInOAuthCallback =
  async (
    code: string,
    rawState: string,
  ): Promise<void> => {
    assertLinkedInConfigured();

    if (!code || !rawState) {
      throw Object.assign(
        new Error(
          'LinkedIn OAuth code or state is missing.',
        ),
        {
          status: 400,
        },
      );
    }

    const stateHash =
      hashValue(rawState);

    /*
     * Atomic state validation.
     *
     * This prevents the same OAuth state
     * from being reused.
     */
    const state =
      await SocialOAuthState.findOneAndUpdate(
        {
          stateHash,

          provider:
            'linkedin',

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
          'LinkedIn OAuth state is invalid, expired, or already used.',
        ),
        {
          status: 400,
        },
      );
    }

    try {
      const token =
        await exchangeCodeForToken(
          code,
        );

      if (!token.access_token) {
        throw new Error(
          'LinkedIn access token was not returned.',
        );
      }

      const profile =
        await getLinkedInUserInfo(
          token.access_token,
        );

      await saveLinkedInAccount(
        String(state.userId),

        String(state.businessId),

        profile,

        token.access_token,

        token.expires_in,

        token.refresh_token,

        token.refresh_token_expires_in,
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
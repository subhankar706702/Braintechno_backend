import crypto from 'node:crypto';

import { env } from '../../../config/env';

import { User } from '../../../models/user.model';

import { SocialAccount } from '../../../models/social-account.model';

import { SocialOAuthState } from '../../../models/social-oauth-state.model';

import { encryptSocialToken } from '../../../utils/social/token-crypto';


const LINKEDIN_AUTHORIZATION_URL =
  'https://www.linkedin.com/oauth/v2/authorization';

const LINKEDIN_TOKEN_URL =
  'https://www.linkedin.com/oauth/v2/accessToken';

const LINKEDIN_USERINFO_URL =
  'https://api.linkedin.com/v2/userinfo';

const STATE_TTL_MS =
  10 * 60 * 1000;


interface LinkedInOAuthStartInput {
  userId: string;

  businessId: string;

  accountId?: unknown;
}


interface LinkedInTokenResponse {
  access_token?: string;

  expires_in?: number;

  refresh_token?: string;

  refresh_token_expires_in?: number;

  scope?: string;

  token_type?: string;
}


interface LinkedInUserInfo {
  sub?: string;

  name?: string;

  given_name?: string;

  family_name?: string;

  email?: string;

  picture?: string;
}


interface LinkedInOAuthContext {
  userId: string;

  businessId: string;

  accountId: string;
}


/*
 * Validate required LinkedIn configuration.
 */
const getRequiredLinkedInConfig =
  (): void => {
    if (!env.linkedinClientId) {
      throw new Error(
        'LinkedIn OAuth is not configured: LINKEDIN_CLIENT_ID is missing.',
      );
    }

    if (!env.linkedinClientSecret) {
      throw new Error(
        'LinkedIn OAuth is not configured: LINKEDIN_CLIENT_SECRET is missing.',
      );
    }

    if (!env.linkedinRedirectUri) {
      throw new Error(
        'LinkedIn OAuth is not configured: LINKEDIN_REDIRECT_URI is missing.',
      );
    }

    if (!env.socialTokenEncryptionKey) {
      throw new Error(
        'Social token encryption is not configured: SOCIAL_TOKEN_ENCRYPTION_KEY is missing.',
      );
    }
  };


/*
 * SHA-256 hash for OAuth state.
 *
 * Raw state is never stored in MongoDB.
 */
const createStateHash =
  (
    state: string,
  ): string => {
    return crypto
      .createHash('sha256')
      .update(state)
      .digest('hex');
  };


/*
 * Cryptographically secure OAuth state.
 */
const createRandomState =
  (): string => {
    return crypto
      .randomBytes(32)
      .toString('hex');
  };


/*
 * Normalize configured LinkedIn scopes.
 */
const getLinkedInScopes =
  (): string => {
    return env.linkedinOAuthScopes
      .split(/\s+/)
      .map(
        scope =>
          scope.trim(),
      )
      .filter(Boolean)
      .join(' ');
  };


/*
 * Resolve user/business context.
 */
const getUserContext =
  async (
    userId: string,
    businessId?: string,
    accountId?: unknown,
  ): Promise<LinkedInOAuthContext> => {

    const user =
      await User.findById(
        userId,
      )
        .select(
          '_id businessId accountId',
        )
        .lean();

    if (!user) {
      throw new Error(
        'User not found.',
      );
    }

    const resolvedBusinessId =
      businessId ||
      (
        user.businessId
          ? String(
              user.businessId,
            )
          : ''
      );

    if (!resolvedBusinessId) {
      throw new Error(
        'Business account is not configured for this user.',
      );
    }

    const resolvedAccountId =
      accountId !== undefined &&
      accountId !== null &&
      String(accountId).trim()
        ? String(accountId).trim()
        : String(
            user.accountId || '',
          ).trim();

    if (!resolvedAccountId) {
      throw new Error(
        'Account ID is not configured for this user.',
      );
    }

    return {
      userId:
        String(
          user._id,
        ),

      businessId:
        resolvedBusinessId,

      accountId:
        resolvedAccountId,
    };
  };


/*
 * Exchange LinkedIn authorization code
 * for access token.
 */
const exchangeCodeForToken =
  async (
    code: string,
  ): Promise<LinkedInTokenResponse> => {

    const body =
      new URLSearchParams();

    body.set(
      'grant_type',
      'authorization_code',
    );

    body.set(
      'code',
      code,
    );

    body.set(
      'redirect_uri',
      env.linkedinRedirectUri,
    );

    body.set(
      'client_id',
      env.linkedinClientId,
    );

    body.set(
      'client_secret',
      env.linkedinClientSecret,
    );

    const response =
      await fetch(
        LINKEDIN_TOKEN_URL,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/x-www-form-urlencoded',

            Accept:
              'application/json',
          },

          body:
            body.toString(),
        },
      );

    const responseText =
      await response.text();

    let responseData:
      LinkedInTokenResponse & {
        error?: string;

        error_description?: string;
      };

    try {
      responseData =
        JSON.parse(
          responseText,
        ) as typeof responseData;
    } catch {
      throw new Error(
        'LinkedIn token endpoint returned an invalid response.',
      );
    }

    if (
      !response.ok ||
      !responseData.access_token
    ) {
      throw new Error(
        responseData.error_description ||
        responseData.error ||
        'Unable to exchange LinkedIn authorization code.',
      );
    }

    return responseData;
  };


/*
 * Get authenticated LinkedIn member.
 */
const getLinkedInUserInfo =
  async (
    accessToken: string,
  ): Promise<LinkedInUserInfo> => {

    const response =
      await fetch(
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

    const responseText =
      await response.text();

    let data:
      LinkedInUserInfo & {
        message?: string;

        error?: string;
      };

    try {
      data =
        JSON.parse(
          responseText,
        ) as typeof data;
    } catch {
      throw new Error(
        'LinkedIn userinfo endpoint returned an invalid response.',
      );
    }

    if (!response.ok) {
      throw new Error(
        data.message ||
        data.error ||
        'Unable to retrieve LinkedIn profile.',
      );
    }

    if (!data.sub) {
      throw new Error(
        'LinkedIn profile ID was not returned.',
      );
    }

    return data;
  };


/*
 * Create LinkedIn OAuth URL.
 */
export const createLinkedInOAuthStart =
  async (
    input: LinkedInOAuthStartInput,
  ): Promise<{
    authorizationUrl: string;
  }> => {

    getRequiredLinkedInConfig();

    const context =
      await getUserContext(
        input.userId,
        input.businessId,
        input.accountId,
      );

    const state =
      createRandomState();

    const stateHash =
      createStateHash(
        state,
      );

    const expiresAt =
      new Date(
        Date.now() +
        STATE_TTL_MS,
      );

    await SocialOAuthState.create({
      userId:
        context.userId,

      businessId:
        context.businessId,

      provider:
        'linkedin',

      stateHash,

      expiresAt,

      usedAt:
        null,
    });

    const params =
      new URLSearchParams();

    params.set(
      'response_type',
      'code',
    );

    params.set(
      'client_id',
      env.linkedinClientId,
    );

    params.set(
      'redirect_uri',
      env.linkedinRedirectUri,
    );

    params.set(
      'state',
      state,
    );

    params.set(
      'scope',
      getLinkedInScopes(),
    );

    return {
      authorizationUrl:
        `${LINKEDIN_AUTHORIZATION_URL}?${params.toString()}`,
    };
  };


/*
 * Handle LinkedIn OAuth callback.
 */
export const handleLinkedInOAuthCallback =
  async (
    code: string,
    state: string,
  ): Promise<{
    accountId: string;

    accountName: string;
  }> => {

    getRequiredLinkedInConfig();

    if (!code) {
      throw new Error(
        'LinkedIn authorization code is missing.',
      );
    }

    if (!state) {
      throw new Error(
        'LinkedIn OAuth state is missing.',
      );
    }

    const stateHash =
      createStateHash(
        state,
      );

    /*
     * Atomically consume state.
     *
     * This prevents callback replay.
     */
    const oauthState =
      await SocialOAuthState.findOneAndUpdate(
        {
          stateHash,

          provider:
            'linkedin',

          expiresAt: {
            $gt: new Date(),
          },

          $or: [
            {
              usedAt: null,
            },

            {
              usedAt: {
                $exists: false,
              },
            },
          ],
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
      ).lean();

    if (!oauthState) {
      throw new Error(
        'LinkedIn OAuth state is invalid or expired.',
      );
    }

    try {
      const context =
        await getUserContext(
          String(
            oauthState.userId,
          ),
          String(
            oauthState.businessId,
          ),
        );

      /*
       * Exchange authorization code.
       */
      const tokenData =
        await exchangeCodeForToken(
          code,
        );

      if (
        !tokenData.access_token
      ) {
        throw new Error(
          'LinkedIn access token was not returned.',
        );
      }

      /*
       * Get LinkedIn member profile.
       */
      const profile =
        await getLinkedInUserInfo(
          tokenData.access_token,
        );

      const accountName =
        profile.name ||
        [
          profile.given_name,
          profile.family_name,
        ]
          .filter(Boolean)
          .join(' ') ||
        profile.email ||
        'LinkedIn Account';

      /*
       * Encrypt access token.
       */
      const accessTokenEncrypted =
        encryptSocialToken(
          tokenData.access_token,
        );

      /*
       * Access token expiration.
       */
      const tokenExpiresAt =
        typeof tokenData.expires_in ===
        'number'
          ? new Date(
              Date.now() +
              tokenData.expires_in *
              1000,
            )
          : null;

      const metadata:
        Record<string, unknown> = {
          provider:
            'linkedin',

          memberId:
            profile.sub,

          email:
            profile.email ||
            null,

          picture:
            profile.picture ||
            null,

          scopes:
            tokenData.scope ||
            getLinkedInScopes(),
        };

      /*
       * Store refresh token encrypted
       * when LinkedIn provides one.
       */
      if (
        tokenData.refresh_token
      ) {
        metadata.refreshTokenEncrypted =
          encryptSocialToken(
            tokenData.refresh_token,
          );
      }

      if (
        typeof
          tokenData.refresh_token_expires_in ===
        'number'
      ) {
        metadata.refreshTokenExpiresAt =
          new Date(
            Date.now() +
            tokenData.refresh_token_expires_in *
            1000,
          );
      }

      /*
       * Upsert LinkedIn account.
       *
       * Existing Facebook and Instagram
       * accounts are untouched.
       */
      const account =
        await SocialAccount.findOneAndUpdate(
          {
            businessId:
              context.businessId,

            platform:
              'LinkedIn',
          },

          {
            $set: {
              userId:
                context.userId,

              businessId:
                context.businessId,

              accountId:
                context.accountId,

              platform:
                'LinkedIn',

              externalAccountId:
                profile.sub,

              accountName,

              pageName:
                accountName,

              accessTokenEncrypted,

              tokenExpiresAt,

              status:
                'Connected',

              metadata,
            },
          },

          {
            new: true,

            upsert: true,

            runValidators: true,

            setDefaultsOnInsert:
              true,
          },
        );

      if (!account) {
        throw new Error(
          'Unable to save LinkedIn account.',
        );
      }

      return {
        accountId:
          String(
            account._id,
          ),

        accountName,
      };

    } catch (error) {

      /*
       * State was already consumed.
       * Delete it after failed processing.
       */
      await SocialOAuthState.deleteOne({
        stateHash,
      });

      throw error;
    }
  };
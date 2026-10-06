import crypto from 'node:crypto';
import { env } from '../../../config/env';
import { SocialOAuthState } from '../../../models/social-oauth-state.model';
import { SocialAccount } from '../../../models/social-account.model';
import { User } from '../../../models/user.model';
import {
  decryptSocialToken,
  encryptSocialToken,
} from '../../../utils/social/token-crypto';

interface FacebookTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; type?: string; code?: number };
}

interface FacebookPage {
  id: string;
  name?: string;
  access_token?: string;
  tasks?: string[];
}

interface FacebookPagesResponse {
  data?: FacebookPage[];
  error?: { message?: string; type?: string; code?: number };
}

const facebookBase = (): string =>
  `https://graph.facebook.com/${env.metaGraphApiVersion}`;

const facebookOAuthBase = (): string =>
  `https://www.facebook.com/${env.metaGraphApiVersion}/dialog/oauth`;

const graphError = (body: { error?: { message?: string } }): string =>
  body?.error?.message || 'Facebook Graph API request failed.';

const assertConfigured = (): void => {
  if (!env.metaAppId || !env.metaAppSecret || !env.metaFacebookRedirectUri) {
    throw Object.assign(
      new Error(
        'Facebook OAuth is not configured. Set META_APP_ID, META_APP_SECRET and META_FACEBOOK_REDIRECT_URI in the backend .env.'
      ),
      { status: 503 }
    );
  }
};

const hashToken = (value: string): string =>
  crypto.createHash('sha256').update(value).digest('hex');

export const createFacebookOAuthStart = async (input: {
  userId: string;
  businessId: string;
  accountId?: string | number;
}): Promise<string> => {
  assertConfigured();

  const rawState = crypto.randomBytes(32).toString('base64url');
  const stateHash = hashToken(rawState);

  await SocialOAuthState.create({
    stateHash,
    userId: input.userId,
    businessId: input.businessId,
    provider: 'facebook',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  const params = new URLSearchParams({
    client_id: env.metaAppId,
    redirect_uri: env.metaFacebookRedirectUri,
    state: rawState,
    response_type: 'code',
    scope: env.facebookOAuthScopes,
  });

  return `${facebookOAuthBase()}?${params.toString()}`;
};

const exchangeCode = async (code: string): Promise<FacebookTokenResponse> => {
  const tokenParams = new URLSearchParams({
    client_id: env.metaAppId,
    client_secret: env.metaAppSecret,
    redirect_uri: env.metaFacebookRedirectUri,
    code,
  });

  const response = await fetch(
    `${facebookBase()}/oauth/access_token?${tokenParams.toString()}`
  );
  const body = (await response.json()) as FacebookTokenResponse;

  if (!response.ok || !body.access_token) {
    throw new Error(graphError(body));
  }

  return body;
};

const getPages = async (userAccessToken: string): Promise<FacebookPage[]> => {
  const response = await fetch(
    `${facebookBase()}/me/accounts?fields=id,name,access_token,tasks&access_token=${encodeURIComponent(userAccessToken)}`
  );
  const body = (await response.json()) as FacebookPagesResponse;

  if (!response.ok) {
    throw new Error(graphError(body));
  }

  return (body.data || []).filter(
    (page): page is FacebookPage & { access_token: string } =>
      Boolean(page.id && page.access_token)
  );
};

export const handleFacebookOAuthCallback = async (
  code: string,
  rawState: string
): Promise<{ selectionToken?: string }> => {
  assertConfigured();

  const stateHash = hashToken(rawState);
  const state = await SocialOAuthState.findOneAndUpdate(
    {
      stateHash,
      provider: 'facebook',
      usedAt: null,
      expiresAt: { $gt: new Date() },
    },
    { $set: { usedAt: new Date() } },
    { new: true }
  );

  if (!state) {
    throw Object.assign(
      new Error('Facebook OAuth state is invalid, expired, or already used.'),
      { status: 400 }
    );
  }

  const tokenBody = await exchangeCode(code);
  const pages = await getPages(tokenBody.access_token!);

  if (pages.length === 0) {
    throw Object.assign(
      new Error(
        'No Facebook Page is available for this account. Make sure the Facebook user manages at least one Page and grant the requested permissions.'
      ),
      { status: 409 }
    );
  }

  if (pages.length === 1) {
    await saveFacebookPage(
      String(state.userId),
      String(state.businessId),
      pages[0]
    );
    await SocialOAuthState.deleteOne({ _id: state._id });
    return {};
  }

  const selectionToken = crypto.randomBytes(32).toString('base64url');
  const selectionExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

  // Keep the short-lived user token encrypted while the user selects a Page.
  await SocialOAuthState.updateOne(
    { _id: state._id },
    {
      $set: {
        selectionTokenHash: hashToken(selectionToken),
        selectionExpiresAt,
        encryptedData: encryptSocialToken(
          JSON.stringify({
            userAccessToken: tokenBody.access_token,
            pages: pages.map((page) => ({
              id: page.id,
              name: page.name || 'Facebook Page',
              accessToken: page.access_token,
            })),
          })
        ),
      },
    }
  );

  return { selectionToken };
};

export const getFacebookPageSelection = async (
  selectionToken: string,
  userId: string
): Promise<Array<{ id: string; name: string }>> => {
  const state = await SocialOAuthState.findOne({
    selectionTokenHash: hashToken(selectionToken),
    userId,
    provider: 'facebook',
    selectionExpiresAt: { $gt: new Date() },
  }).select('+encryptedData');

  if (!state?.encryptedData) {
    throw Object.assign(
      new Error('Facebook Page selection session is invalid or expired.'),
      { status: 400 }
    );
  }

  const data = JSON.parse(decryptSocialToken(state.encryptedData)) as {
    pages: Array<{ id: string; name: string; accessToken: string }>;
  };

  return data.pages.map((page) => ({ id: page.id, name: page.name }));
};

export const selectFacebookPage = async (
  selectionToken: string,
  userId: string,
  pageId: string
): Promise<void> => {
  const state = await SocialOAuthState.findOne({
    selectionTokenHash: hashToken(selectionToken),
    userId,
    provider: 'facebook',
    selectionExpiresAt: { $gt: new Date() },
  }).select('+encryptedData');

  if (!state?.encryptedData) {
    throw Object.assign(
      new Error('Facebook Page selection session is invalid or expired.'),
      { status: 400 }
    );
  }

  const data = JSON.parse(decryptSocialToken(state.encryptedData)) as {
    pages: Array<{ id: string; name: string; accessToken: string }>;
  };
  const page = data.pages.find((item) => item.id === pageId);

  if (!page) {
    throw Object.assign(new Error('Selected Facebook Page is not available.'), {
      status: 404,
    });
  }

  await saveFacebookPage(userId, String(state.businessId), page);

  await SocialOAuthState.deleteOne({ _id: state._id });
};

export const saveFacebookPage = async (
  userId: string,
  businessId: string,
  page: { id: string; name?: string; access_token?: string; accessToken?: string }
): Promise<void> => {
  const accessToken = page.access_token || page.accessToken;

  if (!accessToken) {
    throw new Error('Facebook Page access token was not returned.');
  }

  const user = await User.findById(userId).select('accountId').lean();

  await SocialAccount.findOneAndUpdate(
    { businessId, platform: 'Facebook' },
    {
      $set: {
        userId,
        businessId,
        accountId: user?.accountId ? String(user.accountId) : '',
        platform: 'Facebook',
        externalAccountId: page.id,
        accountName: page.name || 'Facebook Page',
        pageName: page.name || 'Facebook Page',
        accessTokenEncrypted: encryptSocialToken(accessToken),
        tokenExpiresAt: null,
        status: 'Connected',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

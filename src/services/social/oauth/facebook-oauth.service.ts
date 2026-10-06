import crypto from 'node:crypto';

import { env } from '../../../config/env.js';
import { SocialAccount } from '../../../models/social-account.model.js';
import { SocialOAuthState } from '../../../models/social-oauth-state.model.js';
import { encryptSocialToken } from '../../../utils/social/token-crypto.js';

interface FacebookTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; type?: string; code?: number };
}

interface FacebookMeResponse {
  id?: string;
  name?: string;
  error?: { message?: string; type?: string; code?: number };
}

interface FacebookPage {
  id: string;
  name: string;
  access_token?: string;
  tasks?: string[];
}

interface FacebookAccountsResponse {
  data?: FacebookPage[];
  error?: { message?: string; type?: string; code?: number };
}

interface FacebookOAuthPage {
  id: string;
  name: string;
  tasks: string[];
}

export interface FacebookOAuthSelection {
  selectionToken: string;
  pages: FacebookOAuthPage[];
}

export interface FacebookOAuthResult {
  type: 'connected' | 'selection_required';
  page?: {
    id: string;
    name: string;
  };
  selection?: FacebookOAuthSelection;
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function facebookError(response: any, fallback: string): Error {
  const message = clean(response?.error?.message);
  return new Error(message || fallback);
}

function assertConfig(): void {
  const missing: string[] = [];

  if (!env.metaAppId) missing.push('META_APP_ID');
  if (!env.metaAppSecret) missing.push('META_APP_SECRET');
  if (!env.metaFacebookRedirectUri) {
    missing.push('META_FACEBOOK_REDIRECT_URI');
  }
  if (!env.socialTokenEncryptionKey) {
    missing.push('SOCIAL_TOKEN_ENCRYPTION_KEY');
  }

  if (missing.length) {
    throw Object.assign(
      new Error(`Facebook OAuth configuration is incomplete: ${missing.join(', ')}`),
      { status: 503 }
    );
  }
}

function graphUrl(path: string): string {
  return `https://graph.facebook.com/${env.metaGraphApiVersion}${path}`;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers || {}),
    },
  });

  const body = (await response.json().catch(() => ({}))) as T;

  if (!response.ok) {
    throw facebookError(body, `Facebook Graph API returned HTTP ${response.status}.`);
  }

  return body;
}

export class FacebookOAuthService {
  static async createAuthorizationUrl(scope: {
    businessId: string;
    accountId: string | number;
  }): Promise<string> {
    assertConfig();

    const rawState = crypto.randomBytes(32).toString('base64url');
    const stateHash = crypto
      .createHash('sha256')
      .update(rawState)
      .digest('hex');

    await SocialOAuthState.create({
      stateHash,
      businessId: scope.businessId,
      accountId: scope.accountId,
      platform: 'Facebook',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    const params = new URLSearchParams({
      client_id: env.metaAppId,
      redirect_uri: env.metaFacebookRedirectUri,
      state: rawState,
      response_type: 'code',
      auth_type: 'rerequest',
      scope: [
        'public_profile',
        'pages_show_list',
        'pages_read_engagement',
        'pages_manage_posts',
      ].join(','),
    });

    return `https://www.facebook.com/${env.metaGraphApiVersion}/dialog/oauth?${params.toString()}`;
  }

  static async handleCallback(
    code: string,
    rawState: string
  ): Promise<FacebookOAuthResult> {
    assertConfig();

    const stateHash = crypto
      .createHash('sha256')
      .update(rawState)
      .digest('hex');

    const state = await SocialOAuthState.findOneAndUpdate(
      {
        stateHash,
        platform: 'Facebook',
        usedAt: null,
        expiresAt: { $gt: new Date() },
      },
      { $set: { usedAt: new Date() } },
      { new: true }
    ).lean();

    if (!state) {
      throw Object.assign(
        new Error('Facebook OAuth state is invalid, expired, or already used.'),
        { status: 400 }
      );
    }

    const tokenParams = new URLSearchParams({
      client_id: env.metaAppId,
      client_secret: env.metaAppSecret,
      redirect_uri: env.metaFacebookRedirectUri,
      code,
    });

    const token = await getJson<FacebookTokenResponse>(
      `${graphUrl('/oauth/access_token')}?${tokenParams.toString()}`
    );

    const shortLivedUserAccessToken = clean(token.access_token);
    if (!shortLivedUserAccessToken) {
      throw new Error('Facebook did not return a user access token.');
    }

    const longLivedParams = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: env.metaAppId,
      client_secret: env.metaAppSecret,
      fb_exchange_token: shortLivedUserAccessToken,
    });

    const longLived = await getJson<FacebookTokenResponse>(
      `${graphUrl('/oauth/access_token')}?${longLivedParams.toString()}`
    );

    const userAccessToken = clean(longLived.access_token) || shortLivedUserAccessToken;

    const me = await getJson<FacebookMeResponse>(
      `${graphUrl('/me')}?fields=id,name&access_token=${encodeURIComponent(userAccessToken)}`
    );

    const accounts = await getJson<FacebookAccountsResponse>(
      `${graphUrl('/me/accounts')}?fields=id,name,access_token,tasks&access_token=${encodeURIComponent(userAccessToken)}`
    );

    const pages = Array.isArray(accounts.data)
      ? accounts.data.filter(page => page.id && page.name && page.access_token)
      : [];

    if (!pages.length) {
      throw Object.assign(
        new Error('No Facebook Pages were returned for this Facebook account.'),
        { status: 400 }
      );
    }

    if (pages.length === 1) {
      await this.savePage(state.businessId, state.accountId, pages[0], me);

      return {
        type: 'connected',
        page: {
          id: pages[0].id,
          name: pages[0].name,
        },
      };
    }

    const selectionToken = crypto.randomBytes(32).toString('base64url');
    const selectionHash = crypto
      .createHash('sha256')
      .update(selectionToken)
      .digest('hex');

    await SocialOAuthState.findByIdAndUpdate(state._id, {
      $set: {
        stateHash: selectionHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        usedAt: null,
      },
    });

    // Store the encrypted user token temporarily in the OAuth-state document.
    // The field is added dynamically by Mongoose only if the schema is extended
    // with pendingAccessToken; see the supplied model patch.
    await SocialOAuthState.findByIdAndUpdate(state._id, {
      $set: {
        pendingAccessToken: encryptSocialToken(userAccessToken),
        pendingFacebookUserId: clean(me.id),
      },
    });

    return {
      type: 'selection_required',
      selection: {
        selectionToken,
        pages: pages.map(page => ({
          id: page.id,
          name: page.name,
          tasks: Array.isArray(page.tasks) ? page.tasks : [],
        })),
      },
    };
  }

  static async selectPage(
    selectionToken: string,
    pageId: string
  ): Promise<{ id: string; name: string }> {
    assertConfig();

    const selectionHash = crypto
      .createHash('sha256')
      .update(selectionToken)
      .digest('hex');

    const state = await SocialOAuthState.findOne({
      stateHash: selectionHash,
      platform: 'Facebook',
      usedAt: null,
      expiresAt: { $gt: new Date() },
    }).select('+pendingAccessToken +pendingFacebookUserId');

    if (!state) {
      throw Object.assign(
        new Error('Facebook page selection session is invalid or expired.'),
        { status: 400 }
      );
    }

    const pendingAccessToken = clean(state.pendingAccessToken);
    if (!pendingAccessToken) {
      throw Object.assign(
        new Error('Facebook page selection session is incomplete.'),
        { status: 400 }
      );
    }

    const { decryptSocialToken } = await import('../../../utils/social/token-crypto.js');
    const userAccessToken = decryptSocialToken(pendingAccessToken);

    const accounts = await getJson<FacebookAccountsResponse>(
      `${graphUrl('/me/accounts')}?fields=id,name,access_token,tasks&access_token=${encodeURIComponent(userAccessToken)}`
    );

    const page = (accounts.data || []).find(
      item => item.id === pageId && item.access_token
    );

    if (!page) {
      throw Object.assign(
        new Error('The selected Facebook Page is not available to this connection.'),
        { status: 403 }
      );
    }

    await this.savePage(state.businessId, state.accountId, page, {
      id: clean(state.pendingFacebookUserId),
    });

    await SocialOAuthState.deleteOne({ _id: state._id });

    return {
      id: page.id,
      name: page.name,
    };
  }

  private static async savePage(
    businessId: any,
    accountId: string | number,
    page: FacebookPage,
    me: FacebookMeResponse
  ): Promise<void> {
    const pageAccessToken = clean(page.access_token);
    if (!pageAccessToken) {
      throw new Error('Facebook did not return a Page access token.');
    }

    const encryptedToken = encryptSocialToken(pageAccessToken);

    await SocialAccount.findOneAndUpdate(
      {
        businessId,
        accountId,
        platform: 'Facebook',
      },
      {
        $set: {
          accountName: clean(me.name) || clean(page.name),
          pageName: clean(page.name),
          externalAccountId: clean(page.id),
          facebookPageId: clean(page.id),
          facebookUserId: clean(me.id),
          accessToken: encryptedToken,
          status: 'Connected',
          tokenExpiresAt: null,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    );
  }
}

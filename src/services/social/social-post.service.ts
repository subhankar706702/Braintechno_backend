import mongoose from 'mongoose';
import { SocialAccount, SOCIAL_PLATFORMS, type SocialPlatform } from '../../models/social-account.model';
import { SocialPost, type ISocialPost, type SocialPostStatus, type SocialProviderResult } from '../../models/social-post.model';
import { decryptSocialToken } from '../../utils/social/token-crypto';
import { FacebookService } from './providers/facebook.service';
import { InstagramService } from './providers/instagram.service';
import { LinkedInService } from './providers/linkedin.service';
import { GoogleBusinessService } from './providers/google-business.service';
import type { SocialProvider } from './providers/types';

export interface SocialPostScope { userId: string; businessId: string; accountId?: string | number; }
export interface CreateSocialPostInput {
  caption?: unknown; link?: unknown; hashtags?: unknown; cta?: unknown; imageUrl?: unknown;
  platforms?: unknown; platformAdjustments?: unknown; publishedPageId?: unknown; scheduledAt?: unknown;
}

const clean = (value: unknown): string => String(value ?? '').trim();
const providers: Record<SocialPlatform, SocialProvider> = {
  Facebook: new FacebookService(),
  Instagram: new InstagramService(),
  LinkedIn: new LinkedInService(),
  'Google Business Profile': new GoogleBusinessService(),
};

const validPlatforms = (value: unknown): SocialPlatform[] => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => clean(item)).filter((item): item is SocialPlatform => (SOCIAL_PLATFORMS as readonly string[]).includes(item)))];
};

const scopeQuery = (scope: SocialPostScope) => ({ businessId: scope.businessId, userId: scope.userId, ...(scope.accountId ? { accountId: String(scope.accountId) } : {}) });

function assertObjectId(value: string, label: string): void {
  if (!mongoose.isValidObjectId(value)) throw Object.assign(new Error(`Invalid ${label}.`), { status: 400 });
}

export class SocialPostService {
  static async createDraft(scope: SocialPostScope, input: CreateSocialPostInput): Promise<ISocialPost> {
    assertObjectId(scope.userId, 'user id');
    assertObjectId(scope.businessId, 'business id');
    const platforms = validPlatforms(input.platforms);
    if (!platforms.length) throw Object.assign(new Error('Select at least one connected social platform.'), { status: 400 });

    const accounts = await SocialAccount.find({ businessId: scope.businessId, userId: scope.userId, platform: { $in: platforms } }).select('platform status').lean();
    const missing = platforms.filter(platform => !accounts.some(account => account.platform === platform && account.status === 'Connected'));
    if (missing.length) throw Object.assign(new Error(`These social accounts are not connected: ${missing.join(', ')}.`), { status: 409 });

    const post = await SocialPost.create({
      userId: scope.userId,
      businessId: scope.businessId,
      accountId: scope.accountId ? String(scope.accountId) : '',
      caption: clean(input.caption),
      link: clean(input.link),
      hashtags: clean(input.hashtags),
      cta: clean(input.cta),
      imageUrl: clean(input.imageUrl),
      platforms,
      platformAdjustments: input.platformAdjustments && typeof input.platformAdjustments === 'object' ? input.platformAdjustments : {},
      publishedPageId: clean(input.publishedPageId),
      status: 'Draft',
      scheduledAt: null,
      publishedAt: null,
      providerResults: [],
    });
    return post;
  }

  static async list(scope: SocialPostScope, filter?: { status?: SocialPostStatus }): Promise<ISocialPost[]> {
    const query: Record<string, unknown> = scopeQuery(scope);
    if (filter?.status) query.status = filter.status;
    return SocialPost.find(query).sort({ createdAt: -1 }).lean();
  }

  static async get(scope: SocialPostScope, id: string): Promise<ISocialPost | null> {
    assertObjectId(id, 'post id');
    return SocialPost.findOne({ _id: id, ...scopeQuery(scope) }).lean();
  }

  static async updateDraft(scope: SocialPostScope, id: string, input: CreateSocialPostInput): Promise<ISocialPost | null> {
    assertObjectId(id, 'post id');
    const post = await SocialPost.findOne({ _id: id, ...scopeQuery(scope) });
    if (!post) return null;
    if (!['Draft', 'Scheduled', 'Failed'].includes(post.status)) throw Object.assign(new Error('Only draft, scheduled, or failed posts can be edited.'), { status: 409 });

    const platforms = input.platforms === undefined ? post.platforms : validPlatforms(input.platforms);
    if (!platforms.length) throw Object.assign(new Error('Select at least one social platform.'), { status: 400 });
    const accounts = await SocialAccount.find({ businessId: scope.businessId, userId: scope.userId, platform: { $in: platforms } }).select('platform status').lean();
    const missing = platforms.filter(platform => !accounts.some(account => account.platform === platform && account.status === 'Connected'));
    if (missing.length) throw Object.assign(new Error(`These social accounts are not connected: ${missing.join(', ')}.`), { status: 409 });

    if (input.caption !== undefined) post.caption = clean(input.caption);
    if (input.link !== undefined) post.link = clean(input.link);
    if (input.hashtags !== undefined) post.hashtags = clean(input.hashtags);
    if (input.cta !== undefined) post.cta = clean(input.cta);
    if (input.imageUrl !== undefined) post.imageUrl = clean(input.imageUrl);
    if (input.platforms !== undefined) post.platforms = platforms;
    if (input.platformAdjustments !== undefined) post.platformAdjustments = input.platformAdjustments && typeof input.platformAdjustments === 'object' ? input.platformAdjustments as Record<string, unknown> : {};
    if (input.publishedPageId !== undefined) post.publishedPageId = clean(input.publishedPageId);
    if (input.scheduledAt !== undefined) post.scheduledAt = input.scheduledAt ? this.parseFutureDate(input.scheduledAt) : null;
    if (post.status === 'Scheduled' && !post.scheduledAt) post.status = 'Draft';
    await post.save();
    return post.toObject();
  }

  static async schedule(scope: SocialPostScope, id: string, scheduledAtValue: unknown): Promise<ISocialPost> {
    assertObjectId(id, 'post id');
    const post = await SocialPost.findOne({ _id: id, ...scopeQuery(scope) });
    if (!post) throw Object.assign(new Error('Social post not found.'), { status: 404 });
    if (['Published', 'Publishing', 'Cancelled'].includes(post.status)) throw Object.assign(new Error('This post cannot be scheduled in its current status.'), { status: 409 });
    post.scheduledAt = this.parseFutureDate(scheduledAtValue);
    post.status = 'Scheduled';
    post.providerResults = [];
    await post.save();
    return post.toObject();
  }

  static async cancel(scope: SocialPostScope, id: string): Promise<ISocialPost> {
    assertObjectId(id, 'post id');
    const post = await SocialPost.findOne({ _id: id, ...scopeQuery(scope) });
    if (!post) throw Object.assign(new Error('Social post not found.'), { status: 404 });
    if (!['Scheduled', 'Draft', 'Failed'].includes(post.status)) throw Object.assign(new Error('Only scheduled, draft, or failed posts can be cancelled.'), { status: 409 });
    post.status = 'Cancelled';
    await post.save();
    return post.toObject();
  }

  static async publish(scope: SocialPostScope, id: string): Promise<ISocialPost> {
    assertObjectId(id, 'post id');
    const post = await SocialPost.findOne({ _id: id, ...scopeQuery(scope) });
    if (!post) throw Object.assign(new Error('Social post not found.'), { status: 404 });
    if (['Published', 'Publishing', 'Cancelled'].includes(post.status)) throw Object.assign(new Error('This post cannot be published in its current status.'), { status: 409 });
    return this.publishRecord(post);
  }

  static async publishDuePosts(): Promise<number> {
    const due = await SocialPost.find({ status: 'Scheduled', scheduledAt: { $lte: new Date() } }).sort({ scheduledAt: 1 }).limit(20);
    let processed = 0;
    for (const post of due) {
      try { await this.publishRecord(post); } catch { /* record already updated to Failed */ }
      processed += 1;
    }
    return processed;
  }

  private static parseFutureDate(value: unknown): Date {
    const date = new Date(clean(value));
    if (!clean(value) || Number.isNaN(date.getTime())) throw Object.assign(new Error('A valid scheduled date and time are required.'), { status: 400 });
    if (date.getTime() <= Date.now()) throw Object.assign(new Error('Scheduled time must be in the future.'), { status: 400 });
    return date;
  }

  private static async publishRecord(post: import('mongoose').HydratedDocument<ISocialPost>): Promise<ISocialPost> {
    post.status = 'Publishing';
    await post.save();
    const results: SocialProviderResult[] = [];

    try {
      for (const platform of post.platforms) {
        const account = await SocialAccount.findOne({ businessId: post.businessId, userId: post.userId, platform, status: 'Connected' }).select('+accessTokenEncrypted platform externalAccountId tokenExpiresAt metadata').lean();
        if (!account) throw new Error(`${platform} account is not connected.`);
        if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() <= Date.now()) {
          await SocialAccount.updateOne({ _id: account._id }, { $set: { status: 'Expired' } });
          throw new Error(`${platform} access token has expired.`);
        }

        let accessToken: string;
        try { accessToken = decryptSocialToken(account.accessTokenEncrypted); } catch { throw new Error(`${platform} access token could not be decrypted.`); }

        try {
          const result = await providers[platform].publish({
            platform,
            externalAccountId: account.externalAccountId,
            accessToken,
            caption: post.caption,
            link: post.link,
            hashtags: post.hashtags,
            cta: post.cta,
            imageUrl: post.imageUrl,
          });
          results.push({ platform, success: true, providerPostId: result.providerPostId, publishedAt: result.publishedAt });
        } catch (error: any) {
          results.push({ platform, success: false, error: error?.message || `${platform} publishing failed.` });
        }
      }

      post.providerResults = results;
      const allSucceeded = results.length === post.platforms.length && results.every(result => result.success);
      post.status = allSucceeded ? 'Published' : 'Failed';
      post.publishedAt = allSucceeded ? new Date() : null;
      post.scheduledAt = null;
      await post.save();
      return post.toObject();
    } catch (error: any) {
      post.providerResults = results;
      post.status = 'Failed';
      post.publishedAt = null;
      post.scheduledAt = null;
      await post.save();
      throw Object.assign(new Error(error?.message || 'Social publishing failed.'), { status: 502 });
    }
  }
}

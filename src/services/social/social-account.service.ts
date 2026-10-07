import mongoose from 'mongoose';
import { SocialAccount, SOCIAL_PLATFORMS, SOCIAL_ACCOUNT_STATUSES, type SocialAccountStatus, type SocialPlatform } from '../../models/social-account.model';

export interface SocialAccountScope { businessId: string; accountId: string | number; }
export interface SocialAccountResponse {
  id: string; platform: SocialPlatform; accountName: string; pageName: string; externalAccountId: string;
  status: SocialAccountStatus; tokenExpiresAt: Date | null; connected: boolean;
}

export const isSocialPlatform = (value: unknown): value is SocialPlatform =>
  (SOCIAL_PLATFORMS as readonly string[]).includes(String(value));

const toResponse = (item: any): SocialAccountResponse => ({
  id: String(item._id),
  platform: item.platform,
  accountName: item.accountName || '',
  pageName: item.pageName || '',
  externalAccountId: item.externalAccountId || '',
  status: item.status,
  tokenExpiresAt: item.tokenExpiresAt || null,
  connected: item.status === 'Connected',
});

export class SocialAccountService {
  static async list(scope: SocialAccountScope): Promise<SocialAccountResponse[]> {
    const items = await SocialAccount.find({ businessId: scope.businessId, accountId: String(scope.accountId) }).sort({ platform: 1 }).lean();
    const byPlatform = new Map<string, any>(items.map(item => [item.platform, item]));
    return SOCIAL_PLATFORMS.map(platform => byPlatform.has(platform) ? toResponse(byPlatform.get(platform)) : {
      id: '', platform, accountName: '', pageName: '', externalAccountId: '', status: 'Not Connected', tokenExpiresAt: null, connected: false,
    });
  }

  static async getByPlatform(scope: SocialAccountScope, platform: SocialPlatform): Promise<SocialAccountResponse | null> {
    const item = await SocialAccount.findOne({ businessId: scope.businessId, accountId: String(scope.accountId), platform }).lean();
    return item ? toResponse(item) : null;
  }

  static async connect(scope: SocialAccountScope, input: { platform: SocialPlatform; accountName?: string; pageName?: string; externalAccountId: string }): Promise<SocialAccountResponse> {
    if (!isSocialPlatform(input.platform)) throw Object.assign(new Error('Invalid social platform.'), { status: 400 });
    if (!input.externalAccountId.trim()) throw Object.assign(new Error('External account id is required.'), { status: 400 });
    const item = await SocialAccount.findOneAndUpdate(
      { businessId: scope.businessId, accountId: String(scope.accountId), platform: input.platform },
      { $set: { accountName: String(input.accountName || '').trim(), pageName: String(input.pageName || '').trim(), externalAccountId: input.externalAccountId.trim(), status: 'Connected' } },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
    ).lean();
    if (!item) throw Object.assign(new Error('Social account could not be saved.'), { status: 500 });
    return toResponse(item);
  }

  static async update(scope: SocialAccountScope, id: string, input: { accountName?: string; pageName?: string; externalAccountId?: string; status?: SocialAccountStatus; tokenExpiresAt?: Date | null }): Promise<SocialAccountResponse | null> {
    if (!mongoose.isValidObjectId(id)) throw Object.assign(new Error('Invalid social account id.'), { status: 400 });
    const set: Record<string, unknown> = {};
    if (input.accountName !== undefined) set.accountName = String(input.accountName).trim();
    if (input.pageName !== undefined) set.pageName = String(input.pageName).trim();
    if (input.externalAccountId !== undefined) set.externalAccountId = String(input.externalAccountId).trim();
    if (input.status !== undefined && (SOCIAL_ACCOUNT_STATUSES as readonly string[]).includes(input.status)) set.status = input.status;
    if (input.tokenExpiresAt !== undefined) set.tokenExpiresAt = input.tokenExpiresAt;
    if (!Object.keys(set).length) throw Object.assign(new Error('No fields were provided for update.'), { status: 400 });
    const item = await SocialAccount.findOneAndUpdate({ _id: id, businessId: scope.businessId, accountId: String(scope.accountId) }, { $set: set }, { new: true, runValidators: true }).lean();
    return item ? toResponse(item) : null;
  }

  static async disconnect(scope: SocialAccountScope, id: string): Promise<SocialAccountResponse | null> {
    if (!mongoose.isValidObjectId(id)) throw Object.assign(new Error('Invalid social account id.'), { status: 400 });
    const item = await SocialAccount.findOneAndUpdate(
      { _id: id, businessId: scope.businessId, accountId: String(scope.accountId) },
      { $set: { status: 'Not Connected', accessTokenEncrypted: '', tokenExpiresAt: null } },
      { new: true, runValidators: true },
    ).lean();
    return item ? toResponse(item) : null;
  }
}

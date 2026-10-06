import mongoose from 'mongoose';

import {
  SocialAccount,
  SOCIAL_PLATFORMS,
  type SocialPlatform,
  type SocialAccountStatus
} from '../../models/social-account.model.js';

export interface SocialAccountResponse {
  id: string;
  platform: SocialPlatform;
  accountName: string;
  pageName: string;
  externalAccountId: string;
  status: SocialAccountStatus;
  tokenExpiresAt: string | null;
  connected: boolean;
}

export interface SocialAccountScope {
  businessId: string;
  accountId: string | number;
}

const cleanText = (value: unknown): string => String(value ?? '').trim();

export function isSocialPlatform(value: unknown): value is SocialPlatform {
  return (SOCIAL_PLATFORMS as readonly unknown[]).includes(value);
}

function toResponse(item: any): SocialAccountResponse {
  const status = item?.status as SocialAccountStatus;

  return {
    id: String(item._id),
    platform: item.platform,
    accountName: cleanText(item.accountName),
    pageName: cleanText(item.pageName),
    externalAccountId: cleanText(item.externalAccountId),
    status,
    tokenExpiresAt: item.tokenExpiresAt
      ? new Date(item.tokenExpiresAt).toISOString()
      : null,
    connected: status === 'Connected'
  };
}

export class SocialAccountService {
  static async list(scope: SocialAccountScope): Promise<SocialAccountResponse[]> {
    const items = await SocialAccount.find({
      businessId: scope.businessId,
      accountId: scope.accountId
    })
      .sort({ platform: 1 })
      .lean();

    const byPlatform = new Map<string, any>(
      items.map(item => [item.platform, item])
    );

    return SOCIAL_PLATFORMS.map(platform => {
      const existing = byPlatform.get(platform);

      if (existing) {
        return toResponse(existing);
      }

      return {
        id: '',
        platform,
        accountName: '',
        pageName: '',
        externalAccountId: '',
        status: 'Not Connected',
        tokenExpiresAt: null,
        connected: false
      } satisfies SocialAccountResponse;
    });
  }

  static async getByPlatform(
    scope: SocialAccountScope,
    platform: SocialPlatform
  ): Promise<SocialAccountResponse | null> {
    const item = await SocialAccount.findOne({
      businessId: scope.businessId,
      accountId: scope.accountId,
      platform
    }).lean();

    return item ? toResponse(item) : null;
  }

  static async connect(
    scope: SocialAccountScope,
    input: {
      platform: SocialPlatform;
      accountName?: string;
      pageName?: string;
      externalAccountId: string;
    }
  ): Promise<SocialAccountResponse> {
    const item = await SocialAccount.findOneAndUpdate(
      {
        businessId: scope.businessId,
        accountId: scope.accountId,
        platform: input.platform
      },
      {
        $set: {
          accountName: cleanText(input.accountName),
          pageName: cleanText(input.pageName),
          externalAccountId: cleanText(input.externalAccountId),
          status: 'Connected'
        }
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true
      }
    ).lean();

    if (!item) {
      throw Object.assign(new Error('Social account could not be saved.'), {
        status: 500
      });
    }

    return toResponse(item);
  }

  static async update(
    scope: SocialAccountScope,
    id: string,
    input: {
      accountName?: string;
      pageName?: string;
      externalAccountId?: string;
      status?: SocialAccountStatus;
      tokenExpiresAt?: Date | null;
    }
  ): Promise<SocialAccountResponse | null> {
    if (!mongoose.isValidObjectId(id)) {
      throw Object.assign(new Error('Invalid social account id.'), {
        status: 400
      });
    }

    const $set: Record<string, unknown> = {};

    if (input.accountName !== undefined) {
      $set.accountName = cleanText(input.accountName);
    }
    if (input.pageName !== undefined) {
      $set.pageName = cleanText(input.pageName);
    }
    if (input.externalAccountId !== undefined) {
      const externalAccountId = cleanText(input.externalAccountId);
      if (!externalAccountId) {
        throw Object.assign(new Error('External account id cannot be empty.'), {
          status: 400
        });
      }
      $set.externalAccountId = externalAccountId;
    }
    if (input.status !== undefined) {
      $set.status = input.status;
    }
    if (input.tokenExpiresAt !== undefined) {
      $set.tokenExpiresAt = input.tokenExpiresAt;
    }

    if (!Object.keys($set).length) {
      throw Object.assign(new Error('No fields were provided for update.'), {
        status: 400
      });
    }

    const item = await SocialAccount.findOneAndUpdate(
      {
        _id: id,
        businessId: scope.businessId,
        accountId: scope.accountId
      },
      { $set },
      { new: true, runValidators: true }
    ).lean();

    return item ? toResponse(item) : null;
  }

  static async disconnect(
    scope: SocialAccountScope,
    id: string
  ): Promise<SocialAccountResponse | null> {
    if (!mongoose.isValidObjectId(id)) {
      throw Object.assign(new Error('Invalid social account id.'), {
        status: 400
      });
    }

    const item = await SocialAccount.findOneAndUpdate(
      {
        _id: id,
        businessId: scope.businessId,
        accountId: scope.accountId
      },
      {
        $set: {
          status: 'Not Connected',
          tokenExpiresAt: null
        }
      },
      { new: true, runValidators: true }
    ).lean();

    return item ? toResponse(item) : null;
  }
}

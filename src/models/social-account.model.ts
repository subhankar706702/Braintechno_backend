import { Schema, model, type Document, type Types } from 'mongoose';

export const SOCIAL_PLATFORMS = [
  'Facebook',
  'Instagram',
  'LinkedIn',
  'Google Business Profile'
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_ACCOUNT_STATUSES = [
  'Connected',
  'Not Connected',
  'Expired',
  'Error'
] as const;

export type SocialAccountStatus = (typeof SOCIAL_ACCOUNT_STATUSES)[number];

export interface ISocialAccount {
  businessId: Types.ObjectId;
  accountId: string | number;
  platform: SocialPlatform;
  accountName: string;
  pageName: string;
  externalAccountId: string;
  status: SocialAccountStatus;
  tokenExpiresAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type SocialAccountDocument = ISocialAccount & Document;

const socialAccountSchema = new Schema<ISocialAccount>(
  {
    businessId: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true
    },
    accountId: {
      type: Schema.Types.Mixed,
      required: true,
      index: true
    },
    platform: {
      type: String,
      enum: SOCIAL_PLATFORMS,
      required: true,
      index: true
    },
    accountName: {
      type: String,
      default: '',
      trim: true,
      maxlength: 200
    },
    pageName: {
      type: String,
      default: '',
      trim: true,
      maxlength: 200
    },
    externalAccountId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300
    },
    status: {
      type: String,
      enum: SOCIAL_ACCOUNT_STATUSES,
      default: 'Connected',
      required: true,
      index: true
    },
    tokenExpiresAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

socialAccountSchema.index(
  { businessId: 1, accountId: 1, platform: 1 },
  { unique: true }
);

socialAccountSchema.index({ businessId: 1, platform: 1, status: 1 });

export const SocialAccount = model<ISocialAccount>(
  'SocialAccount',
  socialAccountSchema
);

import { Schema, model, Types } from 'mongoose';
import { SOCIAL_PLATFORMS, type SocialPlatform } from './social-account.model';

export const SOCIAL_POST_STATUSES = [
  'Draft',
  'Scheduled',
  'Publishing',
  'Published',
  'Failed',
  'Cancelled',
] as const;

export type SocialPostStatus = (typeof SOCIAL_POST_STATUSES)[number];

export interface SocialProviderResult {
  platform: SocialPlatform;
  success: boolean;
  providerPostId?: string;
  error?: string;
  publishedAt?: Date | null;
}

export interface ISocialPost {
  userId: Types.ObjectId;
  businessId: Types.ObjectId;
  accountId?: string;
  caption: string;
  link: string;
  hashtags: string;
  cta: string;
  imageUrl: string;
  platforms: SocialPlatform[];
  platformAdjustments?: Record<string, unknown>;
  publishedPageId?: string;
  status: SocialPostStatus;
  scheduledAt?: Date | null;
  publishedAt?: Date | null;
  providerResults: SocialProviderResult[];
  createdAt?: Date;
  updatedAt?: Date;
}

const providerResultSchema = new Schema<SocialProviderResult>(
  {
    platform: { type: String, enum: SOCIAL_PLATFORMS, required: true },
    success: { type: Boolean, required: true },
    providerPostId: { type: String, default: '' },
    error: { type: String, default: '' },
    publishedAt: { type: Date, default: null },
  },
  { _id: false },
);

const socialPostSchema = new Schema<ISocialPost>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    accountId: { type: String, default: '', trim: true, index: true },
    caption: { type: String, default: '', trim: true, maxlength: 5000 },
    link: { type: String, default: '', trim: true, maxlength: 2000 },
    hashtags: { type: String, default: '', trim: true, maxlength: 2000 },
    cta: { type: String, default: '', trim: true, maxlength: 100 },
    imageUrl: { type: String, default: '', trim: true, maxlength: 4000 },
    platforms: {
      type: [{ type: String, enum: SOCIAL_PLATFORMS }],
      required: true,
      validate: {
        validator: (value: unknown[]) => Array.isArray(value) && value.length > 0,
        message: 'At least one social platform is required.',
      },
    },
    platformAdjustments: { type: Schema.Types.Mixed, default: {} },
    publishedPageId: { type: String, default: '', trim: true },
    status: { type: String, enum: SOCIAL_POST_STATUSES, default: 'Draft', index: true },
    scheduledAt: { type: Date, default: null, index: true },
    publishedAt: { type: Date, default: null },
    providerResults: { type: [providerResultSchema], default: [] },
  },
  { timestamps: true },
);

socialPostSchema.index({ businessId: 1, status: 1, scheduledAt: 1 });
socialPostSchema.index({ businessId: 1, createdAt: -1 });

export const SocialPost = model<ISocialPost>('SocialPost', socialPostSchema);

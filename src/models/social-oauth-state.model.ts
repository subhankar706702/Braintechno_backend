import { Schema, model, type Types } from 'mongoose';

export interface ISocialOAuthState {
  stateHash: string;
  businessId: Types.ObjectId;
  accountId: string | number;
  platform: 'Facebook';
  expiresAt: Date;
  usedAt?: Date | null;
  pendingAccessToken?: string | null;
  pendingFacebookUserId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const socialOAuthStateSchema = new Schema<ISocialOAuthState>(
  {
    stateHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    businessId: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    accountId: {
      type: Schema.Types.Mixed,
      required: true,
      index: true,
    },
    platform: {
      type: String,
      enum: ['Facebook'],
      required: true,
      default: 'Facebook',
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    usedAt: {
      type: Date,
      default: null,
    },
    pendingAccessToken: {
      type: String,
      default: null,
      select: false,
    },
    pendingFacebookUserId: {
      type: String,
      default: null,
      select: false,
    },
  },
  { timestamps: true }
);

socialOAuthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SocialOAuthState = model<ISocialOAuthState>(
  'SocialOAuthState',
  socialOAuthStateSchema
);

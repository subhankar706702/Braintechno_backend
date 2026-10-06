import {
  Schema,
  model,
  Types,
} from 'mongoose';

export const SOCIAL_PLATFORMS = [
  'Facebook',
  'Instagram',
  'LinkedIn',
  'Google Business Profile',
] as const;

export type SocialPlatform =
  (typeof SOCIAL_PLATFORMS)[number];

export type SocialAccountStatus =
  | 'Connected'
  | 'Not Connected'
  | 'Expired'
  | 'Error';

export interface ISocialAccount {
  userId: Types.ObjectId;

  businessId: Types.ObjectId;

  accountId?: string;

  platform: SocialPlatform;

  externalAccountId: string;

  accountName: string;

  pageName: string;

  accessTokenEncrypted: string;

  tokenExpiresAt?: Date | null;

  status: SocialAccountStatus;

  metadata?: Record<string, unknown>;

  createdAt?: Date;

  updatedAt?: Date;
}

const schema =
  new Schema<ISocialAccount>(
    {
      userId: {
        type: Schema.Types.ObjectId,

        ref: 'User',

        required: true,

        index: true,
      },

      businessId: {
        type: Schema.Types.ObjectId,

        ref: 'Business',

        required: true,

        index: true,
      },

      accountId: {
        type: String,

        default: '',

        trim: true,

        index: true,
      },

      platform: {
        type: String,

        enum: SOCIAL_PLATFORMS,

        required: true,

        index: true,
      },

      externalAccountId: {
        type: String,

        required: true,

        trim: true,
      },

      accountName: {
        type: String,

        default: '',

        trim: true,
      },

      pageName: {
        type: String,

        default: '',

        trim: true,
      },

      accessTokenEncrypted: {
        type: String,

        required: true,

        select: false,
      },

      tokenExpiresAt: {
        type: Date,

        default: null,
      },

      status: {
        type: String,

        enum: [
          'Connected',
          'Not Connected',
          'Expired',
          'Error',
        ],

        default: 'Connected',

        index: true,
      },

      metadata: {
        type: Schema.Types.Mixed,

        default: {},
      },
    },

    {
      timestamps: true,
    },
  );

/*
 * One connection per platform
 * for each business.
 */
schema.index(
  {
    businessId: 1,

    platform: 1,
  },

  {
    unique: true,
  },
);

export const SocialAccount =
  model<ISocialAccount>(
    'SocialAccount',
    schema,
  );
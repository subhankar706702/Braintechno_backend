import { Schema, model, Types } from 'mongoose';

export const SOCIAL_POST_PLATFORMS = [
  'Facebook',
  'Instagram',
  'LinkedIn',
  'Google Business Profile',
] as const;

export type SocialPostPlatform =
  (typeof SOCIAL_POST_PLATFORMS)[number];

export type SocialPostStatus =
  | 'Draft'
  | 'Scheduled'
  | 'Publishing'
  | 'Published'
  | 'Failed'
  | 'Cancelled';

export interface ISocialPostPlatformResult {
  platform: SocialPostPlatform;
  providerPostId?: string;
  status?: string;
  publishedAt?: Date | null;
  error?: string;
}

export interface ISocialPost {
  userId: Types.ObjectId;
  businessId: Types.ObjectId;
  accountId?: string;

  postTo: SocialPostPlatform[];

  content: {
    caption: string;
    link: string;
    hashtags: string;
    cta: string;
  };

  media?: {
    original?: {
      url?: string;
      name?: string;
    };
  };

  status: SocialPostStatus;

  scheduledAt?: Date | null;
  publishedAt?: Date | null;

  platformPosts: ISocialPostPlatformResult[];

  createdAt?: Date;
  updatedAt?: Date;
}

const platformResultSchema =
  new Schema<ISocialPostPlatformResult>(
    {
      platform: {
        type: String,
        enum: SOCIAL_POST_PLATFORMS,
        required: true,
      },

      providerPostId: {
        type: String,
        default: '',
        trim: true,
      },

      status: {
        type: String,
        default: '',
        trim: true,
      },

      publishedAt: {
        type: Date,
        default: null,
      },

      error: {
        type: String,
        default: '',
        trim: true,
      },
    },
    {
      _id: false,
    },
  );

const socialPostSchema =
  new Schema<ISocialPost>(
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

      postTo: {
        type: [
          {
            type: String,
            enum: SOCIAL_POST_PLATFORMS,
          },
        ],
        required: true,
        validate: {
          validator: (value: unknown[]) =>
            Array.isArray(value) && value.length > 0,
          message: 'At least one social platform is required.',
        },
      },

      content: {
        caption: {
          type: String,
          default: '',
          trim: true,
          maxlength: 5000,
        },

        link: {
          type: String,
          default: '',
          trim: true,
        },

        hashtags: {
          type: String,
          default: '',
          trim: true,
        },

        cta: {
          type: String,
          default: '',
          trim: true,
        },
      },

      media: {
        original: {
          url: {
            type: String,
            default: '',
            trim: true,
          },

          name: {
            type: String,
            default: '',
            trim: true,
          },
        },
      },

      status: {
        type: String,
        enum: [
          'Draft',
          'Scheduled',
          'Publishing',
          'Published',
          'Failed',
          'Cancelled',
        ],
        default: 'Draft',
        index: true,
      },

      scheduledAt: {
        type: Date,
        default: null,
        index: true,
      },

      publishedAt: {
        type: Date,
        default: null,
      },

      platformPosts: {
        type: [platformResultSchema],
        default: [],
      },
    },
    {
      timestamps: true,
    },
  );

socialPostSchema.index({
  businessId: 1,
  status: 1,
  scheduledAt: 1,
});

socialPostSchema.index({
  businessId: 1,
  createdAt: -1,
});

export const SocialPost =
  model<ISocialPost>(
    'SocialPost',
    socialPostSchema,
  );
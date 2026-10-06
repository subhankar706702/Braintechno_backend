import { Schema, model, Types } from 'mongoose';

export type SocialOAuthProvider =
  | 'facebook'
  | 'instagram'
  | 'linkedin';

export interface ISocialOAuthState {
  stateHash: string;
  userId: Types.ObjectId;
  businessId: Types.ObjectId;

  provider: SocialOAuthProvider;

  encryptedData?: string;

  expiresAt: Date;
  usedAt?: Date | null;

  selectionTokenHash?: string;
  selectionExpiresAt?: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

const socialOAuthStateSchema =
  new Schema<ISocialOAuthState>(
    {
      stateHash: {
        type: String,
        required: true,
        unique: true,
        index: true,
      },

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

      provider: {
        type: String,
        enum: ['facebook', 'instagram'],
        required: true,
        index: true,
      },

      encryptedData: {
        type: String,
        default: '',
      },

      expiresAt: {
        type: Date,
        required: true,
      },

      usedAt: {
        type: Date,
        default: null,
      },

      selectionTokenHash: {
        type: String,
        default: '',
        index: true,
      },

      selectionExpiresAt: {
        type: Date,
        default: null,
      },
    },
    {
      timestamps: true,
    },
  );

/*
 * MongoDB TTL index.
 *
 * Do NOT add index:true to expiresAt above.
 * Otherwise MongoDB can create duplicate indexes.
 */
socialOAuthStateSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 },
);

export const SocialOAuthState =
  model<ISocialOAuthState>(
    'SocialOAuthState',
    socialOAuthStateSchema,
  );
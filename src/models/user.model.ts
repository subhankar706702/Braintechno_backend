import { Schema, model } from 'mongoose';
import { IUser } from '../interface';

const userSchema = new Schema<IUser>(
  {
    accountId: {
      type: Schema.Types.Mixed,
      required: true,
      unique: true,
      sparse: true,
      index: true
    },

    ownerName: {
      type: String,
      required: true,
      trim: true
    },

    mobile: {
      type: String,
      required: true,
      trim: true,
      index: true,
      unique: true
    },

    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true
    },

    businessName: {
      type: String,
      required: true,
      trim: true
    },

    businessCategory: {
      type: String,
      required: true,
      trim: true
    },

    passwordHash: {
      type: String,
      required: true
    },

    businessId: {
      type: Schema.Types.ObjectId,
      ref: 'Business'
    },

    role: {
      type: String,
      enum: ['owner', 'admin'],
      default: 'owner'
    }
  },
  {
    timestamps: true
  }
);

export const User = model<IUser>('User', userSchema);
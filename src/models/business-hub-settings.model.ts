
import { Schema, model, models } from 'mongoose';

const businessHubSettingsSchema = new Schema(
  {
    accountId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    skuPrefix: {
      type: String,
      trim: true,
      default: 'BT',
      maxlength: 12,
    },
    nextSkuNumber: {
      type: Number,
      min: 1,
      default: 1,
    },
    skuNumberPadding: {
      type: Number,
      min: 1,
      max: 10,
      default: 4,
    },
    defaultLowStockThreshold: {
      type: Number,
      min: 0,
      default: 5,
    },
  },
  { timestamps: true, versionKey: false }
);

export const BusinessHubSettings =
  models['BusinessHubSettings'] ||
  model('BusinessHubSettings', businessHubSettingsSchema);

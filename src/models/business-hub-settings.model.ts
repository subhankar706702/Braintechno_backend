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

    // Account-wise invoice design and print settings.
    invoiceSettings: {
      type: Schema.Types.Mixed,
      default: () => ({
        template: 'classic',
        pageSize: 'a4',
        printColor: 'color',
        primaryColor: '#ff4d6d',
        businessName: '',
        logoDataUrl: '',
        gstin: '',
        address: '',
        phone: '',
        email: '',
        state: '',
        footer: '',
      }),
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export const BusinessHubSettings =
  models['BusinessHubSettings'] ||
  model('BusinessHubSettings', businessHubSettingsSchema);
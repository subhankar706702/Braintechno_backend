import { Schema, model } from 'mongoose';

export const MESSAGE_SOURCES = ['Campaign'] as const;
export const MESSAGE_READ_STATUS = ['unread', 'read'] as const;
export const MESSAGE_QUERY_STATUS = ['New', 'In Progress', 'Resolved'] as const;

const schema = new Schema(
  {
    accountId: {
      type: String,
      required: true,
      trim: true,
      index: true
    },

    businessId: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true
    },

    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true
    },

    campaignId: {
      type: Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
      index: true
    },

    campaignName: {
      type: String,
      default: '',
      trim: true
    },

    campaignSlug: {
      type: String,
      default: '',
      trim: true,
      lowercase: true
    },

    source: {
      type: String,
      enum: MESSAGE_SOURCES,
      default: 'Campaign',
      index: true
    },

    customerName: {
      type: String,
      required: true,
      trim: true
    },

    customerMobile: {
      type: String,
      required: true,
      trim: true
    },

    customerEmail: {
      type: String,
      default: '',
      trim: true,
      lowercase: true
    },

    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000
    },

    readStatus: {
      type: String,
      enum: MESSAGE_READ_STATUS,
      default: 'unread',
      index: true
    },

    readAt: {
      type: Date,
      default: null
    },

    queryStatus: {
      type: String,
      enum: MESSAGE_QUERY_STATUS,
      default: 'New',
      index: true
    }
  },
  { timestamps: true }
);

schema.index({ accountId: 1, createdAt: -1 });
schema.index({ accountId: 1, customerId: 1, createdAt: -1 });
schema.index({ accountId: 1, readStatus: 1, createdAt: -1 });

export const Message = model('Message', schema);

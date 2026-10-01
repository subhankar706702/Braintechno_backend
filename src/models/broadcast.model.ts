import { Schema, model } from 'mongoose';

export const BROADCAST_STATUSES = [
  'Draft',
  'Scheduled',
  'Sending',
  'Sent',
  'Partially Sent',
  'Failed',
  'Cancelled'
] as const;

export const BROADCAST_CHANNELS = ['WhatsApp', 'SMS', 'Email'] as const;
export const BROADCAST_SEND_MODES = ['now', 'schedule'] as const;

const audienceSchema = new Schema(
  {
    customerType: {
      type: String,
      default: 'All',
      trim: true
    },
    sources: {
      type: [String],
      default: []
    },
    city: {
      type: String,
      default: '',
      trim: true
    },
    lastContact: {
      type: String,
      default: 'any',
      trim: true
    }
  },
  { _id: false }
);

const broadcastSchema = new Schema(
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
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000
    },
    campaignId: {
      type: Schema.Types.ObjectId,
      ref: 'Campaign',
      default: null,
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
    audience: {
      type: audienceSchema,
      required: true
    },
    matchedAudienceCount: {
      type: Number,
      default: 0,
      min: 0
    },
    recipientCount: {
      type: Number,
      default: 0,
      min: 0
    },
    excludedRecipientCount: {
      type: Number,
      default: 0,
      min: 0
    },
    channelRecipientCounts: {
      WhatsApp: { type: Number, default: 0, min: 0 },
      SMS: { type: Number, default: 0, min: 0 },
      Email: { type: Number, default: 0, min: 0 }
    },
    channels: {
      type: [String],
      enum: BROADCAST_CHANNELS,
      required: true
    },
    sendMode: {
      type: String,
      enum: BROADCAST_SEND_MODES,
      required: true
    },
    scheduledAt: {
      type: Date,
      default: null
    },
    status: {
      type: String,
      enum: BROADCAST_STATUSES,
      default: 'Draft',
      index: true
    },
    sentCount: {
      type: Number,
      default: 0,
      min: 0
    },
    deliveredCount: {
      type: Number,
      default: 0,
      min: 0
    },
    failedCount: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  { timestamps: true }
);

broadcastSchema.index({ businessId: 1, createdAt: -1 });
broadcastSchema.index({ accountId: 1, status: 1, createdAt: -1 });

export const Broadcast = model('Broadcast', broadcastSchema);

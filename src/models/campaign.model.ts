import { Schema, model } from 'mongoose';
import { ICampaign } from '../interface';

const campaignCycleSchema = new Schema(
  {
    cycleNumber: {
      type: Number,
      required: true
    },
    startedAt: {
      type: Date,
      required: true
    },
    endedAt: {
      type: Date,
      default: null
    },
    status: {
      type: String,
      required: true
    },
    publishAt: {
      type: Date,
      default: null
    },
    endAt: {
      type: Date,
      default: null
    },
    publishedAt: {
      type: Date,
      default: null
    }
  },
  { _id: false }
);

const schema = new Schema<ICampaign>(
  {
    businessId: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true
    },
    businessSlug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true
    },
    publicSlug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
      index: true
    },
    fullSlug: {
      type: String,
      required: true,
      trim: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    pageSlug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true
    },
    category: {
      type: String,
      enum: [
        'business_main_page',
        'discount_offer',
        'festival_offer',
        'product_promotion',
        'service_promotion',
        'event_promotion',
        'limited_time_offer',
        'other'
      ],
      default: 'other',
      index: true
    },
    templateId: {
      type: String,
      required: true,
      immutable: true
    },
    templateName: {
      type: String,
      default: ''
    },
    html: {
      type: String,
      default: ''
    },
    design: {
      type: Schema.Types.Mixed,
      default: null
    },
    description: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'published', 'expired', 'unpublished'],
      default: 'draft',
      index: true
    },
    publishAt: {
      type: Date,
      default: null,
      index: true
    },
    endAt: {
      type: Date,
      default: null,
      index: true
    },
    publishedAt: {
      type: Date,
      default: null
    },
    cycleNumber: {
      type: Number,
      default: 1,
      min: 1
    },
    cycleStartedAt: {
      type: Date,
      default: Date.now
    },
    cycles: {
      type: [campaignCycleSchema],
      default: []
    }
  },
  { timestamps: true }
);

schema.index({ businessId: 1, pageSlug: 1 }, { unique: true });
schema.index({ businessSlug: 1, pageSlug: 1 }, { unique: true });
schema.index({ publicSlug: 1 }, { unique: true });

export const Campaign = model<ICampaign>('Campaign', schema);

import { Schema, model } from 'mongoose';
import { ICampaign } from '../interfaces';

const schema = new Schema<ICampaign>(
  {
    businessId: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true
    },
    templateId: {
      type: String
    },
    html: {
      type: String,
      required: true
    },
    design: {
      type: Schema.Types.Mixed
    },
    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'draft',
      index: true
    },
    interactive: {
      type: Schema.Types.Mixed,
      default: { type: 'standard' }
    }
  },
  { timestamps: true }
);

export const Campaign = model<ICampaign>('Campaign', schema);

import { Schema, model } from 'mongoose';
import { ITemplate } from '../interfaces';

const schema = new Schema<ITemplate>(
  {
    accountId: {
      type: Schema.Types.Mixed,
      required: true,
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
      trim: true
    },
    description: {
      type: String,
      default: ''
    },
    design: {
      type: Schema.Types.Mixed,
      required: true
    },
    html: {
      type: String,
      default: ''
    },
    previewImage: {
      type: String,
      default: ''
    },
    previewImageName: {
      type: String,
      default: ''
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'locked'],
      default: 'draft'
    }
  },
  { timestamps: true }
);

schema.index({ accountId: 1, updatedAt: -1 });

export const Template = model<ITemplate>('Template', schema);

import { Schema, model } from 'mongoose';
import { IPage } from '../interfaces';

const schema = new Schema<IPage>(
  {
    businessId: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true
    },
    templateId: {
      type: Schema.Types.ObjectId,
      ref: 'Template',
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
      trim: true,
      lowercase: true,
      index: true
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
    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'draft',
      index: true
    }
  },
  { timestamps: true }
);

schema.index({ businessId: 1, slug: 1 }, { unique: true });
schema.index({ businessId: 1, templateId: 1 }, { unique: true, sparse: true });

export const Page = model<IPage>('Page', schema);

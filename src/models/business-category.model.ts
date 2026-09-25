import {
  Schema,
  model,
} from 'mongoose';

export interface IBusinessCategory {
  typeId: number;
  name: string;
  isActive: boolean;
  sortOrder: number;
}

const businessCategorySchema =
  new Schema<IBusinessCategory>(
    {
      typeId: {
        type: Number,
        required: true,
        unique: true,
        index: true,
      },

      name: {
        type: String,
        required: true,
        trim: true,
      },

      isActive: {
        type: Boolean,
        default: true,
        index: true,
      },

      sortOrder: {
        type: Number,
        default: 0,
      },
    },
    {
      timestamps: true,
      collection: 'business_categories',
    },
  );

businessCategorySchema.index({
  isActive: 1,
  sortOrder: 1,
  typeId: 1,
});

export const BusinessCategory =
  model<IBusinessCategory>(
    'BusinessCategory',
    businessCategorySchema,
  );

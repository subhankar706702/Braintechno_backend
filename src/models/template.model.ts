import {
  Schema,
  model
} from 'mongoose';

import {
  ITemplate
} from '../interface';

const schema =
  new Schema<ITemplate>(
    {
      accountId: {
        type:
          Schema.Types.Mixed,
        required: true,
        index: true
      },

      businessId: {
        type:
          Schema.Types.ObjectId,
        ref:
          'Business',

        /**
         * accountId 0 = master gallery template.
         * Master template is system-owned, so businessId
         * is intentionally optional.
         */
        required: false,
        default: null,
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
        type:
          Schema.Types.Mixed,
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
        enum: [
          'draft',
          'published',
          'locked'
        ],
        default: 'draft'
      },

      templateType: {
        type: Number,
        default: 0,
        min: 0,
        index: true
      },

      galleryCategory: {
        type: String,
        enum: [
          'new',
          'locked',
          'free',
          'coming_soon'
        ],
        default: 'free',
        index: true
      }
    },
    {
      timestamps: true
    }
  );


schema.index({
  accountId: 1,
  updatedAt: -1
});


schema.index({
  accountId: 1,
  templateType: 1,
  galleryCategory: 1,
  updatedAt: -1
});


export const Template =
  model<ITemplate>(
    'Template',
    schema
  );

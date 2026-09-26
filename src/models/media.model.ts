import { Schema, model } from 'mongoose';
import { IMedia } from '../interface/media.interface';

const mediaSchema = new Schema<IMedia>(
  {
    accountId: {
      type: Schema.Types.Mixed,
      required: true,
      index: true,
    },
    businessId: {
      type: Schema.Types.ObjectId,
      ref: 'Business',
      default: null,
      index: true,
    },
    uploadedByUserId: {
      type: Schema.Types.Mixed,
      default: null,
    },
    kind: {
      type: String,
      enum: ['customer', 'template_preview'],
      required: true,
      index: true,
    },
    mediaType: {
      type: String,
      enum: ['image', 'video', 'document'],
      required: true,
      index: true,
    },
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    originalName: {
      type: String,
      required: true,
      trim: true,
    },
    mimeType: {
      type: String,
      required: true,
      trim: true,
    },
    fileSize: {
      type: Number,
      required: true,
      min: 0,
    },
    storageKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    width: {
      type: Number,
      default: null,
    },
    height: {
      type: Number,
      default: null,
    },
    altText: {
      type: String,
      default: '',
      trim: true,
    },
    sourceTemplateId: {
      type: Schema.Types.ObjectId,
      ref: 'Template',
      default: null,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

mediaSchema.index({
  accountId: 1,
  kind: 1,
  mediaType: 1,
  deletedAt: 1,
  createdAt: -1,
});

mediaSchema.index({
  accountId: 1,
  originalName: 'text',
  fileName: 'text',
});

export const Media = model<IMedia>('Media', mediaSchema);

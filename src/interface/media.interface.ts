import type { Types } from 'mongoose';

export type MediaKind = 'customer' | 'template_preview';
export type MediaType = 'image' | 'video' | 'document';

export interface IMedia {
  accountId: string | number;
  businessId?: Types.ObjectId | null;
  uploadedByUserId?: Types.ObjectId | string | null;
  kind: MediaKind;
  mediaType: MediaType;
  fileName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  storageKey: string;
  url: string;
  width?: number | null;
  height?: number | null;
  altText?: string;
  sourceTemplateId?: Types.ObjectId | null;
  deletedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

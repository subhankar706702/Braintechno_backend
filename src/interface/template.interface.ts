import { Types } from 'mongoose';

export interface ITemplate {
  accountId: string | number;
  businessId: Types.ObjectId;
  name: string;
  description?: string;
  design: unknown;
  html?: string;
  previewImage?: string;
  previewImageName?: string;
  status?: 'draft' | 'published' | 'locked';
  createdAt?: Date;
  updatedAt?: Date;
}

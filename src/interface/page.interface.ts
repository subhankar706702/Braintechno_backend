import { Types } from 'mongoose';

export interface IPage {
  businessId: Types.ObjectId;
  templateId?: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  design: unknown;
  html?: string;
  status?: 'draft' | 'published';
  createdAt?: Date;
  updatedAt?: Date;
}

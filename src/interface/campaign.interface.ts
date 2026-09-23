import { Types } from 'mongoose';

export interface ICampaignInteractive {
  type?: string;
  [key: string]: unknown;
}

export interface ICampaign {
  businessId: Types.ObjectId;
  name: string;
  slug: string;
  templateId?: string;
  html: string;
  design?: unknown;
  status?: 'draft' | 'published';
  interactive?: ICampaignInteractive;
  createdAt?: Date;
  updatedAt?: Date;
}

import { Types } from 'mongoose';

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'published'
  | 'expired'
  | 'unpublished';

export type CampaignCategory =
  | 'business_main_page'
  | 'discount_offer'
  | 'festival_offer'
  | 'product_promotion'
  | 'service_promotion'
  | 'event_promotion'
  | 'limited_time_offer'
  | 'other';

export interface ICampaignCycle {
  cycleNumber: number;
  startedAt: Date;
  endedAt?: Date | null;
  status: CampaignStatus;
  publishAt?: Date | null;
  endAt?: Date | null;
  publishedAt?: Date | null;
}

export interface ICampaign {
  businessId: Types.ObjectId;
  businessSlug: string;
  publicSlug: string;
  fullSlug: string;
  name: string;
  pageSlug: string;
  category: CampaignCategory;
  templateId: string;
  templateName?: string;
  html: string;
  design?: unknown;
  description?: string;
  status: CampaignStatus;
  publishAt?: Date | null;
  endAt?: Date | null;
  publishedAt?: Date | null;
  cycleNumber: number;
  cycleStartedAt: Date;
  cycles?: ICampaignCycle[];
  createdAt?: Date;
  updatedAt?: Date;
}

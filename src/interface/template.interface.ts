import { Types } from 'mongoose';

export type TemplateGalleryCategory =
  | 'new'
  | 'locked'
  | 'free'
  | 'premium'
  | 'coming_soon';

export interface ITemplate {
  accountId: string | number;

  /**
   * Master gallery templates (accountId 0) do not need
   * to belong to a business.
   */
  businessId?: Types.ObjectId | null;

  name: string;
  description?: string;

  design: unknown;
  html?: string;

  previewImage?: string;
  previewImageName?: string;

  status?:
  | 'draft'
  | 'published'
  | 'locked';

  /**
   * Gallery type:
   * 0 = General / All
   * 1 = Jewellery
   * 2 = Cake Shop
   * 3 = Photography
   * 4 = Fashion
   * 5 = Restaurant
   * 6 = Salon & Beauty
   * 7 = Services
   */
  templateType?: number;

  galleryCategory?:
  TemplateGalleryCategory;

  createdAt?: Date;
  updatedAt?: Date;
}

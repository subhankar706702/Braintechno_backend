import { Types } from 'mongoose';

export type BusinessDayKey =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export interface IBusinessDayHours {
  closed: boolean;
  open: string;
  close: string;
}

export interface IBusinessProfile {
  accountId: Types.ObjectId;
  businessLogo?: string;
  tagline?: string;
  aboutBusiness?: string;
  businessMobileNumber?: string;
  businessWhatsAppNumber?: string;
  address?: string;
  area?: string;
  city?: string;
  state?: string;
  pinCode?: string;
  googleMapsUrl?: string;
  businessHoursEnabled?: boolean;
  businessHours?: Record<BusinessDayKey, IBusinessDayHours>;
  socialLinks?: {
    facebook?: string;
    instagram?: string;
    youtube?: string;
    website?: string;
  };
  coverImage?: string;
  brandColors?: {
    primary?: string;
    secondary?: string;
  };
  profileCompletion?: number;
  completedSteps?: number[];
  currentStep?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

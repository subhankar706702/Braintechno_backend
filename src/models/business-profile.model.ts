import { Schema, model } from 'mongoose';
import { IBusinessProfile } from '../interface/business-profile.interface';

const daySchema = new Schema(
  {
    closed: { type: Boolean, default: false },
    open: { type: String, default: '09:00' },
    close: { type: String, default: '18:00' }
  },
  { _id: false }
);

const defaultDay = () => ({
  closed: false,
  open: '09:00',
  close: '18:00'
});

const businessProfileSchema = new Schema<IBusinessProfile>(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
    },
    businessLogo: { type: String, default: '' },
    tagline: { type: String, trim: true, default: '' },
    aboutBusiness: { type: String, trim: true, default: '' },
    businessMobileNumber: { type: String, trim: true, default: '' },
    businessWhatsAppNumber: { type: String, trim: true, default: '' },
    address: { type: String, trim: true, default: '' },
    area: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    pinCode: { type: String, trim: true, default: '' },
    googleMapsUrl: { type: String, trim: true, default: '' },
    businessHoursEnabled: { type: Boolean, default: false },
    businessHours: {
      monday: { type: daySchema, default: defaultDay },
      tuesday: { type: daySchema, default: defaultDay },
      wednesday: { type: daySchema, default: defaultDay },
      thursday: { type: daySchema, default: defaultDay },
      friday: { type: daySchema, default: defaultDay },
      saturday: { type: daySchema, default: defaultDay },
      sunday: { type: daySchema, default: defaultDay }
    },
    socialLinks: {
      facebook: { type: String, trim: true, default: '' },
      instagram: { type: String, trim: true, default: '' },
      youtube: { type: String, trim: true, default: '' },
      website: { type: String, trim: true, default: '' }
    },
    coverImage: { type: String, default: '' },
    brandColors: {
      primary: { type: String, trim: true, default: '#ff4d6d' },
      secondary: { type: String, trim: true, default: '#38bdf8' }
    },
    profileCompletion: { type: Number, min: 0, max: 100, default: 0 },
    completedSteps: { type: [Number], default: [] },
    currentStep: { type: Number, min: 1, max: 6, default: 1 }
  },
  { timestamps: true }
);

export const BusinessProfile = model<IBusinessProfile>(
  'BusinessProfile',
  businessProfileSchema
);

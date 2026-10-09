import { Schema, model } from 'mongoose';

export type ConfiguredBillingCycle = 'monthly' | 'halfYearly' | 'yearly' | 'custom';

export interface ISubscriptionPlanSetting {
  enabled: boolean;
  price: number | null;
  billingCycle: ConfiguredBillingCycle;
}

export interface ISubscriptionSettings {
  key: 'global';
  trialEnabled: boolean;
  trialDays: number;
  gracePeriodHours: number;
  plans: {
    basic: ISubscriptionPlanSetting;
    premium: ISubscriptionPlanSetting;
    custom: ISubscriptionPlanSetting;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

const planSettingSchema = new Schema<ISubscriptionPlanSetting>(
  {
    enabled: { type: Boolean, default: true },
    price: { type: Number, default: null, min: 0 },
    billingCycle: {
      type: String,
      enum: ['monthly', 'halfYearly', 'yearly', 'custom'],
      default: 'monthly',
    },
  },
  { _id: false },
);

const subscriptionSettingsSchema = new Schema<ISubscriptionSettings>(
  {
    key: { type: String, enum: ['global'], required: true, unique: true, default: 'global' },
    trialEnabled: { type: Boolean, default: true },
    trialDays: { type: Number, default: 9, min: 1, max: 365 },
    gracePeriodHours: { type: Number, default: 24, min: 0, max: 168 },
    plans: {
      basic: {
        type: planSettingSchema,
        default: () => ({ enabled: true, price: 399, billingCycle: 'monthly' }),
      },
      premium: {
        type: planSettingSchema,
        default: () => ({ enabled: true, price: 799, billingCycle: 'monthly' }),
      },
      custom: {
        type: planSettingSchema,
        default: () => ({ enabled: true, price: null, billingCycle: 'custom' }),
      },
    },
  },
  { timestamps: true },
);

export const SubscriptionSettings = model<ISubscriptionSettings>('SubscriptionSettings', subscriptionSettingsSchema);

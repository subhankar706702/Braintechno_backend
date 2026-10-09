import { Schema, model } from 'mongoose';

export type ConfiguredBillingCycle = 'monthly' | 'halfYearly' | 'yearly' | 'custom';
export interface IBillingPriceSetting {
  baseAmount: number;
  actualAmount: number;
  discountPercentage: number;
  enabled: boolean;
}
export interface ISubscriptionPlanSetting {
  enabled: boolean;
  billing: { monthly: IBillingPriceSetting; halfYearly: IBillingPriceSetting; yearly: IBillingPriceSetting };
}
export interface ISubscriptionSettings {
  key: 'global'; trialEnabled: boolean; trialDays: number; gracePeriodHours: number;
  plans: { basic: ISubscriptionPlanSetting; premium: ISubscriptionPlanSetting; custom: ISubscriptionPlanSetting };
  createdAt?: Date; updatedAt?: Date;
}
const billingPriceSchema = new Schema<IBillingPriceSetting>({
  baseAmount: { type: Number, default: 0, min: 0 },
  actualAmount: { type: Number, default: 0, min: 0 },
  discountPercentage: { type: Number, default: 0, min: 0, max: 100 },
  enabled: { type: Boolean, default: true },
}, { _id: false });
const planSettingSchema = new Schema<ISubscriptionPlanSetting>({
  enabled: { type: Boolean, default: true },
  billing: {
    monthly: { type: billingPriceSchema, default: () => ({ baseAmount: 0, actualAmount: 0, discountPercentage: 0, enabled: true }) },
    halfYearly: { type: billingPriceSchema, default: () => ({ baseAmount: 0, actualAmount: 0, discountPercentage: 0, enabled: true }) },
    yearly: { type: billingPriceSchema, default: () => ({ baseAmount: 0, actualAmount: 0, discountPercentage: 0, enabled: true }) },
  },
}, { _id: false });
const defaultPlan = () => ({ enabled: true, billing: {
  monthly: { baseAmount: 0, actualAmount: 0, discountPercentage: 0, enabled: true },
  halfYearly: { baseAmount: 0, actualAmount: 0, discountPercentage: 0, enabled: true },
  yearly: { baseAmount: 0, actualAmount: 0, discountPercentage: 0, enabled: true },
} });
const subscriptionSettingsSchema = new Schema<ISubscriptionSettings>({
  key: { type: String, enum: ['global'], required: true, unique: true, default: 'global' },
  trialEnabled: { type: Boolean, default: true }, trialDays: { type: Number, default: 9, min: 1, max: 365 },
  gracePeriodHours: { type: Number, default: 24, min: 0, max: 168 },
  plans: {
    basic: { type: planSettingSchema, default: defaultPlan },
    premium: { type: planSettingSchema, default: defaultPlan },
    custom: { type: planSettingSchema, default: defaultPlan },
  },
}, { timestamps: true });
export const SubscriptionSettings = model<ISubscriptionSettings>('SubscriptionSettings', subscriptionSettingsSchema);

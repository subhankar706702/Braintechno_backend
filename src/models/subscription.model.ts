import { Schema, model, Types } from 'mongoose';

export const SUBSCRIPTION_PLANS = [
  'trial',
  'basic',
  'premium',
  'custom',
] as const;

export type SubscriptionPlan =
  (typeof SUBSCRIPTION_PLANS)[number];

export const SUBSCRIPTION_BILLING_CYCLES = [
  'trial',
  'monthly',
  'halfYearly',
  'yearly',
  'custom',
] as const;

export type SubscriptionBillingCycle =
  (typeof SUBSCRIPTION_BILLING_CYCLES)[number];

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'expired',
  'cancelled',
] as const;

export type SubscriptionStatus =
  (typeof SUBSCRIPTION_STATUSES)[number];

export interface ICustomRequirements {
  extraUsers: number;
  extraStorage: number;
  whatsappCredits: number;
  smsCredits: number;
  emailCredits: number;
  integrations: string[];
  enabledFeatures: string[];
  notes: string;
}

export interface ISubscription {
  businessId: Types.ObjectId;
  accountId: string;
  plan: SubscriptionPlan;
  isCustom: boolean;
  billingCycle: SubscriptionBillingCycle;
  priceSnapshot: number;
  customRequirements: ICustomRequirements;

  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  trialUsedAt: Date | null;

  startsAt: Date | null;
  expiresAt: Date | null;
  pageAccessUntil: Date | null;

  status: SubscriptionStatus;
  previousPlan: SubscriptionPlan | null;

  createdAt?: Date;
  updatedAt?: Date;
}

const customRequirementsSchema =
  new Schema<ICustomRequirements>(
    {
      extraUsers: {
        type: Number,
        default: 0,
        min: 0,
      },

      extraStorage: {
        type: Number,
        default: 0,
        min: 0,
      },

      whatsappCredits: {
        type: Number,
        default: 0,
        min: 0,
      },

      smsCredits: {
        type: Number,
        default: 0,
        min: 0,
      },

      emailCredits: {
        type: Number,
        default: 0,
        min: 0,
      },

      integrations: {
        type: [String],
        default: [],
      },

      enabledFeatures: {
        type: [String],
        default: [],
      },

      notes: {
        type: String,
        default: '',
        trim: true,
      },
    },
    {
      _id: false,
    },
  );

const subscriptionSchema =
  new Schema<ISubscription>(
    {
      businessId: {
        type: Schema.Types.ObjectId,
        ref: 'Business',
        required: true,
        unique: true,
      },

      accountId: {
        type: String,
        required: true,
        trim: true,
        index: true,
      },

      plan: {
        type: String,
        enum: SUBSCRIPTION_PLANS,
        required: true,
        index: true,
      },

      isCustom: {
        type: Boolean,
        default: false,
        index: true,
      },

      billingCycle: {
        type: String,
        enum: SUBSCRIPTION_BILLING_CYCLES,
        required: true,
      },

      priceSnapshot: {
        type: Number,
        default: 0,
        min: 0,
      },

      customRequirements: {
        type: customRequirementsSchema,

        default: () => ({
          extraUsers: 0,
          extraStorage: 0,
          whatsappCredits: 0,
          smsCredits: 0,
          emailCredits: 0,
          integrations: [],
          enabledFeatures: [],
          notes: '',
        }),
      },

      trialStartedAt: {
        type: Date,
        default: null,
      },

      trialEndsAt: {
        type: Date,
        default: null,
      },

      trialUsedAt: {
        type: Date,
        default: null,
      },

      startsAt: {
        type: Date,
        default: null,
      },

      expiresAt: {
        type: Date,
        default: null,
      },

      pageAccessUntil: {
        type: Date,
        default: null,
      },

      status: {
        type: String,
        enum: SUBSCRIPTION_STATUSES,
        required: true,
        index: true,
      },

      previousPlan: {
        type: String,
        enum: SUBSCRIPTION_PLANS,
        default: null,
      },
    },
    {
      timestamps: true,
    },
  );

/*
 * Indexes
 *
 * businessId:
 * Declared only once as a unique schema index.
 * Do NOT add another { businessId: 1 } index here.
 */
subscriptionSchema.index(
  { businessId: 1, status: 1 },
);

subscriptionSchema.index(
  { expiresAt: 1, status: 1 },
);

export const Subscription =
  model<ISubscription>(
    'Subscription',
    subscriptionSchema,
  );
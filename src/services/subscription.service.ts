import { Types } from 'mongoose';
import { Subscription, type ICustomRequirements, type ISubscription, type SubscriptionBillingCycle, type SubscriptionPlan } from '../models/subscription.model';
import { SubscriptionSettings, type ISubscriptionSettings } from '../models/subscription-settings.model';
import { getPlanPermissions, type SubscriptionFeature, type SubscriptionPermissions } from './subscription-permission.service';

export interface SubscriptionContext { businessId: string; accountId: string; }
export type EffectiveSubscriptionStatus = 'trialing' | 'active' | 'expired' | 'cancelled' | 'missing';

const DEFAULT_SETTINGS: ISubscriptionSettings = {
  key: 'global',
  trialEnabled: true,
  trialDays: 9,
  gracePeriodHours: 24,
  plans: {
    basic: { enabled: true, price: 399, billingCycle: 'monthly' },
    premium: { enabled: true, price: 799, billingCycle: 'monthly' },
    custom: { enabled: true, price: null, billingCycle: 'custom' },
  },
};

const EMPTY_CUSTOM_REQUIREMENTS: ICustomRequirements = {
  extraUsers: 0,
  extraStorage: 0,
  whatsappCredits: 0,
  smsCredits: 0,
  emailCredits: 0,
  integrations: [],
  enabledFeatures: [],
  notes: '',
};

const asBusinessId = (value: string) => {
  if (!Types.ObjectId.isValid(value)) throw Object.assign(new Error('Invalid business ID.'), { status: 400 });
  return new Types.ObjectId(value);
};

const mergeSettings = (settings: Partial<ISubscriptionSettings> | null): ISubscriptionSettings => ({
  ...DEFAULT_SETTINGS,
  ...(settings ?? {}),
  plans: {
    ...DEFAULT_SETTINGS.plans,
    ...(settings?.plans ?? {}),
    basic: { ...DEFAULT_SETTINGS.plans.basic, ...(settings?.plans?.basic ?? {}) },
    premium: { ...DEFAULT_SETTINGS.plans.premium, ...(settings?.plans?.premium ?? {}) },
    custom: { ...DEFAULT_SETTINGS.plans.custom, ...(settings?.plans?.custom ?? {}) },
  },
});

export async function getGlobalSubscriptionSettings(): Promise<ISubscriptionSettings> {
  const settings = await SubscriptionSettings.findOneAndUpdate(
    { key: 'global' },
    { $setOnInsert: DEFAULT_SETTINGS },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return mergeSettings(settings);
}

export async function updateGlobalSubscriptionSettings(patch: Partial<ISubscriptionSettings>): Promise<ISubscriptionSettings> {
  const current = await getGlobalSubscriptionSettings();
  const merged = mergeSettings({ ...current, ...patch, plans: { ...current.plans, ...(patch.plans ?? {}) } });
  const saved = await SubscriptionSettings.findOneAndUpdate(
    { key: 'global' },
    { $set: merged },
    { upsert: true, new: true, runValidators: true },
  ).lean();
  return mergeSettings(saved);
}

export async function createTrialIfEligible(context: SubscriptionContext): Promise<ISubscription | null> {
  const businessId = asBusinessId(context.businessId);
  const existing = await Subscription.findOne({ businessId });
  if (existing) return existing;

  const settings = await getGlobalSubscriptionSettings();
  if (!settings.trialEnabled) return null;

  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + settings.trialDays * 24 * 60 * 60 * 1000);
  const pageAccessUntil = new Date(trialEndsAt.getTime() + settings.gracePeriodHours * 60 * 60 * 1000);

  try {
    return await Subscription.create({
      businessId,
      accountId: context.accountId,
      plan: 'trial',
      isCustom: false,
      billingCycle: 'trial',
      priceSnapshot: 0,
      customRequirements: EMPTY_CUSTOM_REQUIREMENTS,
      trialStartedAt: now,
      trialEndsAt,
      trialUsedAt: null,
      startsAt: now,
      expiresAt: trialEndsAt,
      pageAccessUntil,
      status: 'trialing',
      previousPlan: null,
    });
  } catch (error: any) {
    if (error?.code === 11000) return Subscription.findOne({ businessId });
    throw error;
  }
}

export async function getSubscription(context: SubscriptionContext) {
  if (!Types.ObjectId.isValid(context.businessId)) return null;
  return Subscription.findOne({ businessId: new Types.ObjectId(context.businessId) });
}

export async function getEffectiveSubscription(context: SubscriptionContext): Promise<{ subscription: ISubscription | null; status: EffectiveSubscriptionStatus }> {
  const subscription = await getSubscription(context);
  if (!subscription) return { subscription: null, status: 'missing' };
  if (subscription.status === 'cancelled') return { subscription, status: 'cancelled' };

  const now = new Date();
  if (subscription.expiresAt && subscription.expiresAt.getTime() <= now.getTime()) {
    if (subscription.status !== 'expired') {
      subscription.status = 'expired';
      if (subscription.plan === 'trial' && !subscription.trialUsedAt) subscription.trialUsedAt = now;
      await subscription.save();
    }
    return { subscription, status: 'expired' };
  }

  return { subscription, status: subscription.plan === 'trial' ? 'trialing' : 'active' };
}

export async function getPageAccess(context: SubscriptionContext): Promise<{ allowed: boolean; gracePeriod: boolean; pageAccessUntil: Date | null }> {
  const subscription = await getSubscription(context);
  if (!subscription || subscription.status === 'cancelled') return { allowed: false, gracePeriod: false, pageAccessUntil: null };

  const settings = await getGlobalSubscriptionSettings();
  const expiresAt = subscription.expiresAt?.getTime() ?? 0;
  const dynamicPageAccessUntil = new Date(expiresAt + settings.gracePeriodHours * 60 * 60 * 1000);
  const now = Date.now();
  return {
    allowed: expiresAt > now || now <= dynamicPageAccessUntil.getTime(),
    gracePeriod: expiresAt <= now && now <= dynamicPageAccessUntil.getTime(),
    pageAccessUntil: dynamicPageAccessUntil,
  };
}

export async function hasFeatureAccess(context: SubscriptionContext, feature: SubscriptionFeature): Promise<boolean> {
  const { subscription, status } = await getEffectiveSubscription(context);
  if (!subscription || status === 'expired' || status === 'cancelled' || status === 'missing') return false;
  const permissions = getPlanPermissions(subscription.plan, subscription.customRequirements?.enabledFeatures ?? []);
  return permissions.features[feature] === true;
}

export async function getSubscriptionPermissions(context: SubscriptionContext): Promise<SubscriptionPermissions | null> {
  const { subscription, status } = await getEffectiveSubscription(context);
  if (!subscription || status === 'expired' || status === 'cancelled' || status === 'missing') return null;
  return getPlanPermissions(subscription.plan, subscription.customRequirements?.enabledFeatures ?? []);
}

export async function getAvailablePlans() {
  const settings = await getGlobalSubscriptionSettings();
  return settings.plans;
}

export async function startTrial(context: SubscriptionContext) {
  const existing = await getSubscription(context);
  if (existing) throw Object.assign(new Error('A subscription already exists for this business.'), { status: 409 });
  const settings = await getGlobalSubscriptionSettings();
  if (!settings.trialEnabled) throw Object.assign(new Error('Free trial is currently disabled.'), { status: 400 });
  const created = await createTrialIfEligible(context);
  if (!created) throw Object.assign(new Error('Free trial is currently disabled.'), { status: 400 });
  return created;
}

export function calculateExpiry(start: Date, billingCycle: Exclude<SubscriptionBillingCycle, 'trial' | 'custom'>): Date {
  const result = new Date(start);
  if (billingCycle === 'monthly') result.setMonth(result.getMonth() + 1);
  else if (billingCycle === 'halfYearly') result.setMonth(result.getMonth() + 6);
  else result.setFullYear(result.getFullYear() + 1);
  return result;
}

export async function activatePaidSubscription(input: {
  context: SubscriptionContext;
  plan: 'basic' | 'premium' | 'custom';
  billingCycle: Exclude<SubscriptionBillingCycle, 'trial'>;
  amount: number;
  customRequirements?: Partial<ICustomRequirements>;
}) {
  const businessId = asBusinessId(input.context.businessId);
  const existing = await Subscription.findOne({ businessId });
  const settings = await getGlobalSubscriptionSettings();
  const planSetting = settings.plans[input.plan];

  if (!planSetting.enabled) throw Object.assign(new Error('Selected plan is currently disabled.'), { status: 400 });
  if (input.plan !== 'custom' && input.billingCycle !== planSetting.billingCycle) {
    throw Object.assign(new Error('Selected billing cycle is not available for this plan.'), { status: 400 });
  }
  if (input.plan === 'custom' || planSetting.price === null) {
    if (input.amount < 0) throw Object.assign(new Error('Invalid custom amount.'), { status: 400 });
  } else if (input.amount !== planSetting.price) {
    throw Object.assign(new Error('Payment amount does not match the current plan price.'), { status: 409 });
  }

  const now = new Date();
  const expiresAt = input.billingCycle === 'custom'
    ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    : calculateExpiry(now, input.billingCycle);

  const updated = await Subscription.findOneAndUpdate(
    { businessId },
    {
      $set: {
        accountId: input.context.accountId,
        plan: input.plan,
        isCustom: input.plan === 'custom',
        billingCycle: input.billingCycle,
        priceSnapshot: input.amount,
        customRequirements: { ...EMPTY_CUSTOM_REQUIREMENTS, ...(input.customRequirements ?? {}) },
        trialStartedAt: existing?.trialStartedAt ?? null,
        trialEndsAt: existing?.trialEndsAt ?? null,
        trialUsedAt: existing?.plan === 'trial' ? now : existing?.trialUsedAt ?? null,
        startsAt: now,
        expiresAt,
        pageAccessUntil: expiresAt,
        status: 'active',
        previousPlan: existing?.plan ?? null,
      },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  );

  return updated;
}

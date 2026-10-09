import type { SubscriptionPlan } from '../models/subscription.model';

export const SUBSCRIPTION_FEATURES = [
  'dashboard',
  'customers',
  'campaigns',
  'broadcast',
  'social',
  'analytics',
  'communication_wallet',
  'payment_history',
  'invoice',
  'support',
] as const;

export type SubscriptionFeature = (typeof SUBSCRIPTION_FEATURES)[number];

export interface SubscriptionPermissions {
  plan: SubscriptionPlan;
  features: Record<SubscriptionFeature, boolean>;
}

const BASIC_FEATURES: readonly SubscriptionFeature[] = [
  'dashboard',
  'customers',
  'campaigns',
  'broadcast',
  'social',
  'communication_wallet',
  'payment_history',
  'invoice',
  'support',
];

const createFeatureMap = (enabled: readonly SubscriptionFeature[]) => {
  const set = new Set(enabled);
  return SUBSCRIPTION_FEATURES.reduce((map, feature) => {
    map[feature] = set.has(feature);
    return map;
  }, {} as Record<SubscriptionFeature, boolean>);
};

export function getPlanPermissions(plan: SubscriptionPlan, customFeatures: readonly string[] = []): SubscriptionPermissions {
  if (plan === 'premium') {
    return { plan, features: createFeatureMap(SUBSCRIPTION_FEATURES) };
  }

  if (plan === 'custom') {
    const valid = customFeatures.filter(
      (feature): feature is SubscriptionFeature => (SUBSCRIPTION_FEATURES as readonly string[]).includes(feature),
    );
    if (!valid.includes('dashboard')) valid.push('dashboard');
    return { plan, features: createFeatureMap(valid) };
  }

  return { plan, features: createFeatureMap(BASIC_FEATURES) };
}

export function hasPlanFeatureAccess(plan: SubscriptionPlan, feature: SubscriptionFeature, customFeatures: readonly string[] = []): boolean {
  return getPlanPermissions(plan, customFeatures).features[feature] === true;
}

export function getEnabledPlanFeatures(plan: SubscriptionPlan, customFeatures: readonly string[] = []): SubscriptionFeature[] {
  const permissions = getPlanPermissions(plan, customFeatures);
  return SUBSCRIPTION_FEATURES.filter((feature) => permissions.features[feature]);
}

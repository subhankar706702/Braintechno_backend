import { Router } from 'express';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { User } from '../models/user.model';
import { getAvailablePlans, getGlobalSubscriptionSettings, getPageAccess, getSubscription, getSubscriptionPermissions, startTrial, updateGlobalSubscriptionSettings } from '../services/subscription.service';

const router = Router();

async function context(userId: string) {
  const user = await User.findById(userId).select('businessId accountId').lean();
  if (!user?.businessId) throw Object.assign(new Error('Your business account is not configured.'), { status: 400 });
  return { businessId: String(user.businessId), accountId: user.accountId ? String(user.accountId) : '' };
}

router.get('/plans', async (_req, res, next) => {
  try { return res.json({ plans: await getAvailablePlans() }); } catch (e) { return next(e); }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const ctx = await context(req.auth!.userId);
    const [subscription, permissions, page, settings] = await Promise.all([
      getSubscription(ctx),
      getSubscriptionPermissions(ctx),
      getPageAccess(ctx),
      getGlobalSubscriptionSettings(),
    ]);
    const status = !subscription ? 'missing' : subscription.status === 'cancelled' ? 'cancelled' : subscription.expiresAt && subscription.expiresAt.getTime() <= Date.now() ? 'expired' : subscription.plan === 'trial' ? 'trialing' : 'active';
    return res.json({ subscription, status, pageAccess: page.allowed, pageAccessUntil: page.pageAccessUntil, gracePeriod: page.gracePeriod, permissions, plans: settings.plans });
  } catch (e) { return next(e); }
});

router.get('/permissions', requireAuth, async (req, res, next) => {
  try {
    const ctx = await context(req.auth!.userId);
    const permissions = await getSubscriptionPermissions(ctx);
    return res.json({ permissions, features: permissions ? Object.entries(permissions.features).filter(([, enabled]) => enabled).map(([feature]) => feature) : [] });
  } catch (e) { return next(e); }
});

router.post('/trial', requireAuth, async (req, res, next) => {
  try { return res.status(201).json(await startTrial(await context(req.auth!.userId))); } catch (e) { return next(e); }
});

router.get('/admin/settings', requireAuth, requireAdmin, async (_req, res, next) => {
  try { return res.json(await getGlobalSubscriptionSettings()); } catch (e) { return next(e); }
});

router.patch('/admin/settings', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const body = req.body ?? {};
    if (body.trialDays !== undefined && (!Number.isInteger(body.trialDays) || body.trialDays < 1 || body.trialDays > 365)) return res.status(400).json({ message: 'trialDays must be an integer between 1 and 365.' });
    if (body.gracePeriodHours !== undefined && (!Number.isInteger(body.gracePeriodHours) || body.gracePeriodHours < 0 || body.gracePeriodHours > 168)) return res.status(400).json({ message: 'gracePeriodHours must be an integer between 0 and 168.' });
    if (body.trialEnabled !== undefined && typeof body.trialEnabled !== 'boolean') return res.status(400).json({ message: 'trialEnabled must be boolean.' });

    const plans = body.plans ?? {};
    for (const name of ['basic', 'premium', 'custom']) {
      const plan = plans[name];
      if (!plan) continue;
      if (plan.enabled !== undefined && typeof plan.enabled !== 'boolean') return res.status(400).json({ message: `${name}.enabled must be boolean.` });
      if (plan.price !== undefined && plan.price !== null && (typeof plan.price !== 'number' || !Number.isFinite(plan.price) || plan.price < 0)) return res.status(400).json({ message: `${name}.price must be null or a non-negative number.` });
      if (plan.billingCycle !== undefined && !['monthly', 'halfYearly', 'yearly', 'custom'].includes(plan.billingCycle)) return res.status(400).json({ message: `${name}.billingCycle is invalid.` });
    }

    return res.json(await updateGlobalSubscriptionSettings({ trialEnabled: body.trialEnabled, trialDays: body.trialDays, gracePeriodHours: body.gracePeriodHours, plans }));
  } catch (e) { return next(e); }
});

export default router;

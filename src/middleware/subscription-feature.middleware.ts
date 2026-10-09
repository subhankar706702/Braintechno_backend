import type { NextFunction, Request, Response } from 'express';
import type { SubscriptionFeature } from '../services/subscription-permission.service';
import { getPageAccess, hasFeatureAccess } from '../services/subscription.service';

export function requireSubscriptionPage(nextHandler?: (req: Request, res: Response) => unknown) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const businessId = req.auth?.businessId;
      const accountId = req.auth?.accountId ? String(req.auth.accountId) : '';
      if (!businessId) return res.status(403).json({ message: 'Business subscription context is missing.' });
      const access = await getPageAccess({ businessId, accountId });
      if (!access.allowed) return res.status(403).json({ message: 'Your subscription has expired. Page access is unavailable.', code: 'SUBSCRIPTION_PAGE_UNAVAILABLE' });
      if (nextHandler) return await nextHandler(req, res);
      return next();
    } catch (error) { return next(error); }
  };
}

export function requireFeature(feature: SubscriptionFeature) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const businessId = req.auth?.businessId;
      const accountId = req.auth?.accountId ? String(req.auth.accountId) : '';
      if (!businessId) return res.status(403).json({ message: 'Business subscription context is missing.' });
      const access = await getPageAccess({ businessId, accountId });
      if (!access.allowed) return res.status(403).json({ message: 'Your subscription has expired.', code: 'SUBSCRIPTION_EXPIRED' });
      if (access.gracePeriod) return res.status(403).json({ message: 'This subscription is in the grace period. Subscription features are unavailable until renewal.', code: 'SUBSCRIPTION_GRACE_PERIOD' });
      if (!(await hasFeatureAccess({ businessId, accountId }, feature))) return res.status(403).json({ message: `The '${feature}' feature is not available on your current plan.`, code: 'SUBSCRIPTION_FEATURE_RESTRICTED', feature });
      return next();
    } catch (error) { return next(error); }
  };
}

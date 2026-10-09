import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { User } from '../models/user.model';
import { cancelPayment, createPayment, getPaymentForBusiness, listAllPayments, listPaymentsForBusiness } from '../services/payment.service';

const router = Router();

async function context(userId: string) {
  const user = await User.findById(userId).select('businessId accountId').lean();
  if (!user?.businessId) throw Object.assign(new Error('Your business account is not configured.'), { status: 400 });
  return { businessId: String(user.businessId), accountId: user.accountId ? String(user.accountId) : '' };
}

router.post('/create', requireAuth, async (req, res, next) => {
  try {
    const ctx = await context(req.auth!.userId);
    const plan = String(req.body?.plan ?? '') as 'basic' | 'premium' | 'custom';
    const billingCycle = String(req.body?.billingCycle ?? '') as 'monthly' | 'halfYearly' | 'yearly' | 'custom';
    if (!['basic', 'premium', 'custom'].includes(plan)) return res.status(400).json({ message: 'Invalid plan.' });
    if (!['monthly', 'halfYearly', 'yearly', 'custom'].includes(billingCycle)) return res.status(400).json({ message: 'Invalid billing cycle.' });
    return res.status(201).json(await createPayment({ ...ctx, plan, billingCycle, metadata: typeof req.body?.metadata === 'object' ? req.body.metadata : {} }));
  } catch (e) { return next(e); }
});

router.get('/', requireAuth, async (req, res, next) => {
  try { return res.json(await listPaymentsForBusiness((await context(req.auth!.userId)).businessId)); } catch (e) { return next(e); }
});

router.get('/:paymentId', requireAuth, async (req, res, next) => {
  try {
    const payment = await getPaymentForBusiness(req.params.paymentId, (await context(req.auth!.userId)).businessId);
    if (!payment) return res.status(404).json({ message: 'Payment not found.' });
    return res.json(payment);
  } catch (e) { return next(e); }
});

router.post('/:paymentId/cancel', requireAuth, async (req, res, next) => {
  try { return res.json(await cancelPayment(req.params.paymentId, (await context(req.auth!.userId)).businessId)); } catch (e) { return next(e); }
});

export default router;

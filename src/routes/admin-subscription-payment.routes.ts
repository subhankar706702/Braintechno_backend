import { Router } from 'express';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { listAllPayments, markPaymentFailed, markPaymentSucceeded } from '../services/payment.service';
import { getGlobalSubscriptionSettings, updateGlobalSubscriptionSettings } from '../services/subscription.service';
import type { PaymentStatus } from '../models/payment.model';

const router = Router();
router.use(requireAuth, requireAdmin);

router.get('/settings', async (_req, res, next) => {
  try { return res.json(await getGlobalSubscriptionSettings()); } catch (e) { return next(e); }
});

router.patch('/settings', async (req, res, next) => {
  try { return res.json(await updateGlobalSubscriptionSettings(req.body ?? {})); } catch (e) { return next(e); }
});

router.get('/payments', async (req, res, next) => {
  try {
    const raw = typeof req.query.status === 'string' ? req.query.status : undefined;
    const allowed: PaymentStatus[] = ['pending', 'processing', 'success', 'failed', 'cancelled', 'refunded'];
    if (raw && !allowed.includes(raw as PaymentStatus)) return res.status(400).json({ message: 'Invalid payment status.' });
    return res.json(await listAllPayments(raw as PaymentStatus | undefined));
  } catch (e) { return next(e); }
});


router.get('/payments/:paymentId', async (req, res, next) => {
  try {
    const payments = await listAllPayments();
    const payment = payments.find((item) => item.paymentId === req.params.paymentId);
    if (!payment) return res.status(404).json({ message: 'Payment not found.' });
    return res.json(payment);
  } catch (e) { return next(e); }
});

router.post('/payments/:paymentId/success', async (req, res, next) => {
  try {
    const gatewayPaymentId = String(req.body?.gatewayPaymentId ?? '').trim();
    if (!gatewayPaymentId) return res.status(400).json({ message: 'gatewayPaymentId is required.' });
    return res.json(await markPaymentSucceeded({
      paymentId: req.params.paymentId,
      gateway: String(req.body?.gateway ?? 'admin').trim() || 'admin',
      gatewayPaymentId,
      gatewaySignature: req.body?.gatewaySignature ? String(req.body.gatewaySignature) : null,
    }));
  } catch (e) { return next(e); }
});

router.post('/payments/:paymentId/fail', async (req, res, next) => {
  try {
    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) return res.status(400).json({ message: 'Failure reason is required.' });
    return res.json(await markPaymentFailed(req.params.paymentId, reason));
  } catch (e) { return next(e); }
});

export default router;

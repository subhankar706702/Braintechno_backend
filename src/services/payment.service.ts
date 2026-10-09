import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { Payment, type IPayment, type PaymentStatus } from '../models/payment.model';
import { getGlobalSubscriptionSettings, activatePaidSubscription } from './subscription.service';

const id = () => `PAY_${Date.now()}_${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

export interface CreatePaymentInput {
  businessId: string;
  accountId: string;
  plan: 'basic' | 'premium' | 'custom';
  billingCycle: 'monthly' | 'halfYearly' | 'yearly' | 'custom';
  metadata?: Record<string, unknown>;
}

export async function createPayment(input: CreatePaymentInput): Promise<IPayment> {
  if (!Types.ObjectId.isValid(input.businessId)) throw Object.assign(new Error('Invalid business ID.'), { status: 400 });
  const settings = await getGlobalSubscriptionSettings();
  const planSetting = settings.plans[input.plan];
  if (!planSetting.enabled) throw Object.assign(new Error('Selected plan is currently unavailable.'), { status: 400 });
  if (input.plan !== 'custom' && input.billingCycle !== planSetting.billingCycle) throw Object.assign(new Error('Selected billing cycle is not available for this plan.'), { status: 400 });
  if (input.plan === 'custom' && input.billingCycle !== 'custom') throw Object.assign(new Error('Custom plan requires custom billing cycle.'), { status: 400 });
  if (planSetting.price === null && input.plan !== 'custom') throw Object.assign(new Error('Selected plan does not have a configured price.'), { status: 400 });

  const amount = planSetting.price ?? 0;
  if (amount <= 0) throw Object.assign(new Error('Selected plan is not purchasable until a valid price is configured.'), { status: 400 });

  return Payment.create({
    paymentId: id(),
    businessId: new Types.ObjectId(input.businessId),
    accountId: input.accountId,
    plan: input.plan,
    billingCycle: input.billingCycle,
    amount,
    priceSnapshot: amount,
    currency: 'INR',
    status: 'pending',
    metadata: input.metadata ?? {},
  });
}

export async function getPaymentForBusiness(paymentId: string, businessId: string) {
  if (!Types.ObjectId.isValid(businessId)) return null;
  return Payment.findOne({ paymentId, businessId: new Types.ObjectId(businessId) });
}

export async function listPaymentsForBusiness(businessId: string) {
  if (!Types.ObjectId.isValid(businessId)) return [];
  return Payment.find({ businessId: new Types.ObjectId(businessId) }).sort({ createdAt: -1 }).lean();
}

export async function markPaymentProcessing(paymentId: string, gatewayOrderId: string, gateway: string) {
  const payment = await Payment.findOne({ paymentId });
  if (!payment) throw Object.assign(new Error('Payment not found.'), { status: 404 });
  if (payment.status !== 'pending' && payment.status !== 'processing') throw Object.assign(new Error('Payment is no longer awaiting gateway processing.'), { status: 409 });
  payment.status = 'processing';
  payment.gateway = gateway;
  payment.gatewayOrderId = gatewayOrderId;
  await payment.save();
  return payment;
}

export async function markPaymentSucceeded(input: { paymentId: string; gateway: string; gatewayPaymentId: string; gatewaySignature?: string | null }) {
  const payment = await Payment.findOne({ paymentId });
  if (!payment) throw Object.assign(new Error('Payment not found.'), { status: 404 });
  if (payment.status === 'success') return payment;
  if (payment.status === 'refunded' || payment.status === 'cancelled') throw Object.assign(new Error('Payment cannot be completed from its current state.'), { status: 409 });

  payment.status = 'success';
  payment.gateway = input.gateway;
  payment.gatewayPaymentId = input.gatewayPaymentId;
  payment.gatewaySignature = input.gatewaySignature ?? null;
  payment.paidAt = new Date();
  payment.failureReason = null;
  await payment.save();

  await activatePaidSubscription({
    context: { businessId: String(payment.businessId), accountId: payment.accountId },
    plan: payment.plan,
    billingCycle: payment.billingCycle,
    amount: payment.priceSnapshot,
  });
  return payment;
}

export async function markPaymentFailed(paymentId: string, reason: string, gatewayPaymentId?: string) {
  const payment = await Payment.findOne({ paymentId });
  if (!payment) throw Object.assign(new Error('Payment not found.'), { status: 404 });
  if (payment.status === 'success') throw Object.assign(new Error('A successful payment cannot be marked as failed.'), { status: 409 });
  payment.status = 'failed';
  payment.failureReason = reason.trim().slice(0, 500) || 'Payment failed.';
  if (gatewayPaymentId) payment.gatewayPaymentId = gatewayPaymentId;
  await payment.save();
  return payment;
}

export async function cancelPayment(paymentId: string, businessId: string) {
  const payment = await getPaymentForBusiness(paymentId, businessId);
  if (!payment) throw Object.assign(new Error('Payment not found.'), { status: 404 });
  if (payment.status === 'success') throw Object.assign(new Error('A successful payment cannot be cancelled.'), { status: 409 });
  payment.status = 'cancelled';
  await payment.save();
  return payment;
}

export async function listAllPayments(status?: PaymentStatus) {
  const filter = status ? { status } : {};
  return Payment.find(filter).sort({ createdAt: -1 }).limit(500).lean();
}

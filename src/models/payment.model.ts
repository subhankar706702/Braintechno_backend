import { Schema, model, Types } from 'mongoose';

export const PAYMENT_STATUSES = ['pending', 'processing', 'success', 'failed', 'cancelled', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface IPayment {
  paymentId: string;
  businessId: Types.ObjectId;
  accountId: string;
  plan: 'basic' | 'premium' | 'custom';
  billingCycle: 'monthly' | 'halfYearly' | 'yearly' | 'custom';
  amount: number;
  priceSnapshot: number;
  currency: string;
  status: PaymentStatus;
  gateway: string | null;
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  gatewaySignature: string | null;
  failureReason: string | null;
  metadata: Record<string, unknown>;
  paidAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    paymentId: { type: String, required: true, unique: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    accountId: { type: String, required: true, trim: true, index: true },
    plan: { type: String, enum: ['basic', 'premium', 'custom'], required: true },
    billingCycle: { type: String, enum: ['monthly', 'halfYearly', 'yearly', 'custom'], required: true },
    amount: { type: Number, required: true, min: 0 },
    priceSnapshot: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR', uppercase: true, trim: true },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'pending', index: true },
    gateway: { type: String, default: null, trim: true },
    gatewayOrderId: { type: String, default: null, index: true },
    gatewayPaymentId: { type: String, default: null, index: true },
    gatewaySignature: { type: String, default: null },
    failureReason: { type: String, default: null, trim: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true },
);

paymentSchema.index({ businessId: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ gateway: 1, gatewayOrderId: 1 });

export const Payment = model<IPayment>('Payment', paymentSchema);

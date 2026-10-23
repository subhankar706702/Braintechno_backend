import { Schema, model, models } from 'mongoose';

export const BUSINESS_TRANSACTION_TYPES = ['sale', 'expense'] as const;
export const BUSINESS_TRANSACTION_PAYMENT_METHODS = [
  'Cash', 'UPI / QR', 'Bank Transfer', 'Card', 'Other',
] as const;

const businessHubTransactionSchema = new Schema(
  {
    accountId: { type: String, required: true, trim: true, index: true },
    userId: { type: String, required: true, trim: true, index: true },
    type: { type: String, enum: BUSINESS_TRANSACTION_TYPES, required: true, index: true },
    entryDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
    category: { type: String, required: true, trim: true, maxlength: 80 },
    amount: { type: Number, required: true, min: 0.01, max: 100000000000 },
    paymentMethod: { type: String, enum: BUSINESS_TRANSACTION_PAYMENT_METHODS, default: 'Cash' },
    note: { type: String, trim: true, maxlength: 500, default: '' },
  },
  { timestamps: true, versionKey: false },
);

businessHubTransactionSchema.index({ accountId: 1, entryDate: -1, createdAt: -1 });

export const BusinessHubTransaction =
  models['BusinessHubTransaction'] || model('BusinessHubTransaction', businessHubTransactionSchema);

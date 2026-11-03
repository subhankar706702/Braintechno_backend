import { Schema, model, models } from 'mongoose';

const invoiceCounterSchema = new Schema(
  {
    accountId: { type: String, required: true, trim: true },
    // 'ALL' is the account-wide counter. Old year-specific records remain valid.
    year: { type: String, required: true, trim: true, maxlength: 4, default: 'ALL' },
    sequence: { type: Number, required: true, min: 0, default: 0 },
    prefix: { type: String, required: true, trim: true, maxlength: 20, default: 'BTECH' },
    padding: { type: Number, required: true, min: 1, max: 12, default: 5 },
    // Small idempotency window for non-persisted full-payment stock sales.
    stockSaleKeys: { type: [String], default: [] },
  },
  { timestamps: true, versionKey: false },
);

invoiceCounterSchema.index({ accountId: 1, year: 1 }, { unique: true });

export const BusinessHubInvoiceCounter =
  models['BusinessHubInvoiceCounter'] ||
  model('BusinessHubInvoiceCounter', invoiceCounterSchema);
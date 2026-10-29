import { Schema, model, models } from 'mongoose';

const invoiceCounterSchema = new Schema({
  accountId: { type: String, required: true, trim: true },
  year: { type: String, required: true, trim: true, maxlength: 4 },
  sequence: { type: Number, required: true, min: 0, default: 0 },
}, { timestamps: true, versionKey: false });

invoiceCounterSchema.index({ accountId: 1, year: 1 }, { unique: true });

export const BusinessHubInvoiceCounter =
  models['BusinessHubInvoiceCounter'] ||
  model('BusinessHubInvoiceCounter', invoiceCounterSchema);

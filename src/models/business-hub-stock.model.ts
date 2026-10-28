import { Schema, model, models } from 'mongoose';

export const STOCK_UNITS = ['piece', 'kg', 'g', 'litre', 'ml', 'packet', 'box', 'dozen', 'metre', 'other'] as const;
const stockSchema = new Schema({
  accountId: { type: String, required: true, trim: true, index: true },
  userId: { type: String, required: true, trim: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
  sku: { type: String, trim: true, maxlength: 60, default: '' },
  imageUrl: { type: String, trim: true, maxlength: 2000, default: '' },
  originalPrice: { type: Number, required: true, min: 0 },
  discountPrice: { type: Number, required: true, min: 0 },
  gstEnabled: { type: Boolean, default: false },
  gstRate: { type: Number, min: 0, max: 100, default: 0 },
  quantity: { type: Number, required: true, min: 0 },
  unit: { type: String, enum: STOCK_UNITS, default: 'piece' },
  lowStockThreshold: { type: Number, min: 0, default: null },
}, { timestamps: true, versionKey: false });
stockSchema.index({ accountId: 1, sku: 1 }, { unique: true, partialFilterExpression: { sku: { $type: 'string', $gt: '' } } });
stockSchema.index({ accountId: 1, name: 1 });
export const BusinessHubStock = models['BusinessHubStock'] || model('BusinessHubStock', stockSchema);

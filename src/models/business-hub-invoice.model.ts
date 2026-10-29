
import { Schema, model, models } from 'mongoose';

const invoiceCustomerSchema = new Schema(
  {
    name: { type: String, trim: true, maxlength: 150, default: '' },
    mobile: { type: String, trim: true, maxlength: 20, default: '' },
    email: { type: String, trim: true, maxlength: 254, default: '' },
    address: { type: String, trim: true, maxlength: 1000, default: '' },
    gstin: { type: String, trim: true, uppercase: true, maxlength: 15, default: '' },
  },
  { _id: false },
);

const invoiceItemSchema = new Schema(
  {
    stockItemId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 1000, default: '' },
    sku: { type: String, trim: true, maxlength: 60, default: '' },
    quantity: { type: Number, required: true, min: 1 },
    unit: { type: String, required: true, trim: true, maxlength: 30 },
    unitPrice: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, required: true, min: 0, max: 100 },
    gstEnabled: { type: Boolean, required: true, default: false },
    gstRate: { type: Number, required: true, min: 0, max: 100 },
    lineSubtotal: { type: Number, required: true, min: 0 },
    lineDiscount: { type: Number, required: true, min: 0 },
    lineTax: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const invoiceCalculationSchema = new Schema(
  {
    subtotal: { type: Number, required: true, min: 0 },
    discountTotal: { type: Number, required: true, min: 0 },
    taxableAmount: { type: Number, required: true, min: 0 },
    gstTotal: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, required: true, min: 0 },
    dueAmount: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const invoiceSchema = new Schema(
  {
    accountId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      trim: true,
    },
    invoiceNumber: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },
    status: {
      type: String,
      enum: ['finalized', 'cancelled'],
      default: 'finalized',
      required: true,
    },
    invoiceDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    customer: {
      type: invoiceCustomerSchema,
      required: true,
      default: () => ({}),
    },
    items: {
      type: [invoiceItemSchema],
      required: true,
      validate: {
        validator: (items: unknown[]) => items.length > 0,
        message: 'An invoice must contain at least one product.',
      },
    },
    calculation: {
      type: invoiceCalculationSchema,
      required: true,
    },
    paymentMethod: {
      type: String,
      enum: ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Other'],
      required: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },
    dueRecordId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

invoiceSchema.index(
  { accountId: 1, invoiceNumber: 1 },
  { unique: true },
);

invoiceSchema.index(
  { accountId: 1, idempotencyKey: 1 },
  { unique: true },
);

invoiceSchema.index({ accountId: 1, invoiceDate: -1 });

export const BusinessHubInvoice =
  models['BusinessHubInvoice'] ||
  model('BusinessHubInvoice', invoiceSchema);

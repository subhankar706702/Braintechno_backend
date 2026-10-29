
import { Schema, model, models } from 'mongoose';

const dueRecordSchema = new Schema(
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
    invoiceId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    invoiceNumber: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    customer: {
      name: { type: String, required: true, trim: true, maxlength: 150 },
      mobile: { type: String, required: true, trim: true, maxlength: 20 },
      email: { type: String, trim: true, maxlength: 254, default: '' },
      address: { type: String, trim: true, maxlength: 1000, default: '' },
    },
    invoiceTotal: {
      type: Number,
      required: true,
      min: 0,
    },
    amountPaid: {
      type: Number,
      required: true,
      min: 0,
    },
    balanceDue: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['due', 'partially-paid', 'paid'],
      required: true,
      default: 'due',
      index: true,
    },
    payments: [
      {
        amount: { type: Number, required: true, min: 0.01 },
        paymentMethod: {
          type: String,
          enum: ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Other'],
          required: true,
        },
        paidAt: { type: Date, required: true, default: Date.now },
        note: { type: String, trim: true, maxlength: 500, default: '' },
      },
    ],
    settledAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

dueRecordSchema.index({ accountId: 1, status: 1, createdAt: -1 });
dueRecordSchema.index({ accountId: 1, invoiceId: 1 }, { unique: true });

export const BusinessHubDueRecord =
  models['BusinessHubDueRecord'] ||
  model('BusinessHubDueRecord', dueRecordSchema);

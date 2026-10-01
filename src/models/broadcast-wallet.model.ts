import { Schema, model } from 'mongoose';

const schema = new Schema(
  {
    accountId: { type: String, required: true, trim: true, unique: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    WhatsApp: { type: Number, default: 0, min: 0 },
    SMS: { type: Number, default: 0, min: 0 },
    Email: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

export const BroadcastWallet = model('BroadcastWallet', schema);

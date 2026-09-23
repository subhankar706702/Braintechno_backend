import { Schema, model } from 'mongoose';
import { ICounter } from '../interfaces';

const schema = new Schema<ICounter>(
  {
    key: {
      type: String,
      required: true,
      unique: true
    },
    seq: {
      type: Number,
      required: true,
      default: 0
    }
  },
  { versionKey: false }
);

export const Counter = model<ICounter>('Counter', schema);

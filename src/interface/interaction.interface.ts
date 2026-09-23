import { Types } from 'mongoose';

export interface IInteraction {
  businessId?: Types.ObjectId;
  campaignId?: Types.ObjectId;
  event: string;
  source?: string;
  metadata?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
}

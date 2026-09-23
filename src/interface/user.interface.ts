import { Types } from 'mongoose';

export interface IUser {
  accountId: string | number;
  ownerName: string;
  mobile: string;
  email: string;
  businessName: string;
  businessCategory: string;
  passwordHash: string;
  businessId?: Types.ObjectId;
  role?: 'owner' | 'admin';
  createdAt?: Date;
  updatedAt?: Date;
}

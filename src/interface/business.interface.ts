import { Types } from 'mongoose';

export interface IBusiness {
  name: string;
  slug: string;
  ownerId?: Types.ObjectId;
  status?: 'active' | 'inactive';
  createdAt?: Date;
  updatedAt?: Date;
}

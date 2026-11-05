import mongoose from 'mongoose';
import { Customer } from '../models/customer.model.js';

import {
  env,
} from './env.js';

export async function connectDatabase(): Promise<void> {
  await mongoose.connect(
    env.mongodbUri,
  );

  // Older deployments may still have the former unique email index.
  // Remove only that obsolete index; keep the account-scoped unique mobile index.
  try {
    await Customer.collection.dropIndex('accountId_1_emailNormalized_1');
    console.log('[BRAIN TECHNO] Removed obsolete unique customer email index');
  } catch (error: any) {
    // MongoDB error 27 means the index does not exist; this is expected on new DBs.
    if (
      error?.code !== 27 &&
      error?.code !== 26 &&
      error?.codeName !== 'IndexNotFound' &&
      error?.codeName !== 'NamespaceNotFound'
    ) {
      throw error;
    }
  }

  console.log(
    '[BRAIN TECHNO] MongoDB connected',
  );
}
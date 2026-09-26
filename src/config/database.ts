import mongoose from 'mongoose';

import {
  env,
} from './env.js';

export async function connectDatabase(): Promise<void> {
  await mongoose.connect(
    env.mongodbUri,
  );

  console.log(
    '[BRAIN TECHNO] MongoDB connected',
  );
}
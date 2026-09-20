import { app } from './app.js';
import { connectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { bootstrapDevelopmentData } from './services/bootstrap.service.js';

async function start() {
  try {
    await connectDatabase();
    await bootstrapDevelopmentData();
    app.listen(env.port, () => console.log(`[BRAIN TECHNO] API running at http://localhost:${env.port}`));
  } catch (error) {
    console.error('[BRAIN TECHNO] Could not start backend.', error);
    process.exit(1);
  }
}
void start();

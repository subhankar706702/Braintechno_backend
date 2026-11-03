import { app } from './app.js';
import { connectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { cleanupPaidInvoices } from './jobs/social/scheduled-social-post.job.js';

async function startServer(): Promise<void> {
  await connectDatabase();

  // Run once at startup and then every six hours. Retention is measured from
  // the exact settledAt timestamp, so the cleanup never runs early.
  void cleanupPaidInvoices().catch(error => {
    console.error('[Invoice cleanup] Initial cleanup failed:', error);
  });
  const cleanupTimer = setInterval(() => {
    void cleanupPaidInvoices().catch(error => {
      console.error('[Invoice cleanup] Scheduled cleanup failed:', error);
    });
  }, 6 * 60 * 60 * 1000);
  cleanupTimer.unref?.();

  app.listen(
    env.port,
    () => {
      console.log(
        `[BRAIN TECHNO] API running at http://localhost:${env.port}`,
      );
    },
  );
}

startServer().catch(
  (error) => {
    console.error(
      '[BRAIN TECHNO] Failed to start server',
      error,
    );

    process.exit(1);
  },
);
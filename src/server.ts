import { app } from './app.js';
import { connectDatabase } from './config/database.js';
import { env } from './config/env.js';

async function startServer(): Promise<void> {
  await connectDatabase();

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
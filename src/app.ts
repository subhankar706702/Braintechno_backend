import express from 'express';
import path from 'node:path';
import cors from 'cors';
import { env } from './config/env.js';
import adminRoutes from './routes/admin.routes.js';
import authRoutes from './routes/auth.routes.js';
import businessRoutes from './routes/business.routes.js';
import campaignRoutes from './routes/campaign.routes.js';
import pageRoutes from './routes/page.routes.js';
import templateRoutes from './routes/template.routes.js';

export const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: env.frontendUrl, credentials: true }));
app.use(express.json({ limit: '25mb' }));
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));
app.get('/api/health', (_req, res) => res.json({ name: 'BRAIN TECHNO API', status: 'ok', timezone: 'Asia/Kolkata' }));
app.use('/api/auth', authRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/pages', pageRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/campaign', campaignRoutes); // compatibility with older frontend/network calls
app.use('/api/admin', adminRoutes);
app.use((_req, res) => res.status(404).json({ message: 'Route not found.' }));
app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[BRAIN TECHNO]', error);
  const duplicate = error?.code === 11000;
  const validation = error?.name === 'ValidationError' || error?.name === 'CastError';
  return res.status(duplicate ? 409 : validation ? 400 : 500).json({
    message: duplicate ? 'A record with this value already exists.' : validation ? error.message : 'Unexpected server error.'
  });
});

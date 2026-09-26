import express from 'express';
import path from 'node:path';
import cors from 'cors';

import { env } from './config/env';

import adminRoutes from './routes/admin.routes';
import authRoutes from './routes/auth.routes';
import businessRoutes from './routes/business.routes';
import campaignRoutes from './routes/campaign.routes';
import customerRoutes from './routes/customer.router';
import pageRoutes from './routes/page.routes';
import templateRoutes from './routes/template.routes';
import businessProfileRoutes from './routes/business-profile.routes';
import businessCategoryRoutes from './routes/business-category.routes';
import uploadRoutes from './routes/upload';

export const app = express();

app.disable('x-powered-by');

app.use(
  cors({
    origin: env.frontendUrl,
    credentials: true,
  })
);

app.use(
  express.json({
    limit: '25mb',
  })
);

app.use(
  '/uploads',
  express.static(path.resolve(process.cwd(), 'uploads'))
);

app.get('/api/health', (_req, res) =>
  res.json({
    name: 'BRAIN TECHNO API',
    status: 'ok',
    timezone: 'Asia/Kolkata',
  })
);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/business/profile', businessProfileRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/pages', pageRoutes);
app.use('/api/business-categories', businessCategoryRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/campaign', campaignRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/admin', adminRoutes);


// R2 Upload API Endpoint
app.use('/api', uploadRoutes);

// 404 Route
app.use((_req, res) =>
  res.status(404).json({
    message: 'Route not found.',
  })
);

// Global Error Handler
app.use(
  (
    error: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('[BRAIN TECHNO]', error);

    const duplicate = error?.code === 11000;
    const validation =
      error?.name === 'ValidationError' || error?.name === 'CastError';

    return res
      .status(
        duplicate ? 409 : validation ? 400 : 500
      )
      .json({
        message: duplicate
          ? 'A record with this value already exists.'
          : validation
          ? error.message
          : 'Unexpected server error.',
      });
  }
);
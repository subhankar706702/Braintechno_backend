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
import mediaRoutes from './routes/media.routes';
import messageRoutes from './routes/message.routes';
import broadcastRoutes from './routes/broadcast.routes';
import broadcastWalletRoutes from './routes/broadcast-wallet.routes';
import socialRoutes from './routes/social.routes';
import socialPostRoutes from './routes/social-post.routes';

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

// Kept only for legacy URLs that may already exist in stored records.
// New editor/customer media and template previews are uploaded to R2.
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
app.use('/api/messages', messageRoutes);
app.use('/api/broadcasts/wallet', broadcastWalletRoutes);
app.use('/api/broadcasts', broadcastRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/social/posts', socialPostRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/social', socialPostRoutes);

// Account-scoped editor media library + hidden template-preview assets.
app.use('/api/media', mediaRoutes);

// Existing generic R2 upload endpoint kept for existing project callers.
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
    const multerError = error?.name === 'MulterError';

    return res
      .status(
        duplicate ? 409 : multerError ? 400 : validation ? 400 : 500
      )
      .json({
        message: duplicate
          ? 'A record with this value already exists.'
          : multerError
          ? error.message
          : validation
          ? error.message
          : 'Unexpected server error.',
      });
  }
);

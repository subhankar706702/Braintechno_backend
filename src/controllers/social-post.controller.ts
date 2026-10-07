import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { User } from '../models/user.model';
import { SocialPostService, type SocialPostScope } from '../services/social/social-post.service';

const clean = (value: unknown): string => String(value ?? '').trim();

async function resolveScope(req: Request): Promise<SocialPostScope | null> {
  if (!req.auth) return null;
  const user = await User.findById(req.auth.userId).select('businessId accountId').lean();
  if (!user?.businessId || !mongoose.isValidObjectId(String(user.businessId))) return null;
  return {
    userId: String(req.auth.userId),
    businessId: String(user.businessId),
    accountId: req.auth.accountId ?? user.accountId ?? undefined,
  };
}

export class SocialPostController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const scope = await resolveScope(req);
      if (!scope) return res.status(409).json({ message: 'Your business account is not configured.' });
      const status = clean(req.query.status) || undefined;
      const items = await SocialPostService.list(scope, status ? { status: status as any } : undefined);
      return res.json({ items });
    } catch (error) { return next(error); }
  }

  static async get(req: Request, res: Response, next: NextFunction) {
    try {
      const scope = await resolveScope(req);
      if (!scope) return res.status(409).json({ message: 'Your business account is not configured.' });
      const item = await SocialPostService.get(scope, req.params.id);
      if (!item) return res.status(404).json({ message: 'Social post not found.' });
      return res.json(item);
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message });
      return next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const scope = await resolveScope(req);
      if (!scope) return res.status(409).json({ message: 'Your business account is not configured.' });
      const item = await SocialPostService.createDraft(scope, req.body || {});
      return res.status(201).json(item);
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message });
      return next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const scope = await resolveScope(req);
      if (!scope) return res.status(409).json({ message: 'Your business account is not configured.' });
      const item = await SocialPostService.updateDraft(scope, req.params.id, req.body || {});
      if (!item) return res.status(404).json({ message: 'Social post not found.' });
      return res.json(item);
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message });
      return next(error);
    }
  }

  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const scope = await resolveScope(req);
      if (!scope) return res.status(409).json({ message: 'Your business account is not configured.' });
      const item = await SocialPostService.get(scope, req.params.id);
      if (!item) return res.status(404).json({ message: 'Social post not found.' });
      if (!['Draft', 'Failed', 'Cancelled'].includes(item.status)) return res.status(409).json({ message: 'Only draft, failed, or cancelled posts can be deleted.' });
      await import('../models/social-post.model').then(({ SocialPost }) => SocialPost.deleteOne({ _id: req.params.id, userId: scope.userId, businessId: scope.businessId }));
      return res.json({ message: 'Social post deleted.' });
    } catch (error) { return next(error); }
  }

  static async publish(req: Request, res: Response, next: NextFunction) {
    try {
      const scope = await resolveScope(req);
      if (!scope) return res.status(409).json({ message: 'Your business account is not configured.' });
      const item = await SocialPostService.publish(scope, req.params.id);
      if (item.status === 'Failed') return res.status(502).json(item);
      return res.json(item);
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message });
      return next(error);
    }
  }

  static async schedule(req: Request, res: Response, next: NextFunction) {
    try {
      const scope = await resolveScope(req);
      if (!scope) return res.status(409).json({ message: 'Your business account is not configured.' });
      const item = await SocialPostService.schedule(scope, req.params.id, req.body?.scheduledAt);
      return res.json(item);
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message });
      return next(error);
    }
  }

  static async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      const scope = await resolveScope(req);
      if (!scope) return res.status(409).json({ message: 'Your business account is not configured.' });
      return res.json(await SocialPostService.cancel(scope, req.params.id));
    } catch (error: any) {
      if (error?.status) return res.status(error.status).json({ message: error.message });
      return next(error);
    }
  }
}

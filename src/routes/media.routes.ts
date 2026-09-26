import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { Types } from 'mongoose';

import { env } from '../config/env.js';
import { s3Client } from '../config/r2.js';
import { requireAuth } from '../middleware/auth.js';
import { MediaKind, MediaType } from '../interface/media.interface.js';
import { Media } from '../models/media.model.js';

const router = Router();

const MAX_FILE_SIZE = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
});

function safePart(value: unknown): string {
  const normalized = String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-');

  return normalized || 'unknown';
}

function safeExtension(file: Express.Multer.File): string {
  const fromName = path.extname(file.originalname || '').toLowerCase();
  const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

  if (allowed.has(fromName)) {
    return fromName === '.jpeg' ? '.jpg' : fromName;
  }

  const byMime: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/avif': '.avif',
  };

  return byMime[file.mimetype] || '.bin';
}

function publicUrlForKey(key: string): string {
  if (!env.r2PublicUrl) {
    throw new Error('R2_PUBLIC_URL is required to return public media URLs.');
  }

  return `${env.r2PublicUrl}/${key}`;
}

function normalizeKind(value: unknown): MediaKind {
  return value === 'template_preview' ? 'template_preview' : 'customer';
}

function normalizeMediaType(value: unknown): MediaType {
  if (value === 'video' || value === 'document') {
    return value;
  }

  return 'image';
}
function serializeMedia(item: any) {
  return {
    id: String(item._id),
    accountId: item.accountId,
    uploadedByUserId: item.uploadedByUserId ?? null,
    kind: item.kind,
    mediaType: item.mediaType,
    fileName: item.fileName,
    originalName: item.originalName,
    mimeType: item.mimeType,
    fileSize: item.fileSize,
    storageKey: item.storageKey,
    url: item.url,
    width: item.width ?? null,
    height: item.height ?? null,
    altText: item.altText ?? '',
    sourceTemplateId: item.sourceTemplateId ? String(item.sourceTemplateId) : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

async function uploadImageToR2(options: {
  file: Express.Multer.File;
  accountId: string | number;
  kind: MediaKind;
}): Promise<{ storageKey: string; url: string; fileName: string }> {
  const { file, accountId, kind } = options;

  if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
    throw Object.assign(new Error('Only JPG, PNG, WEBP, GIF or AVIF images are allowed.'), {
      statusCode: 400,
    });
  }

  const extension = safeExtension(file);
  const fileName = `${Date.now()}-${randomUUID()}${extension}`;
  const storageKey = [
    'accounts',
    safePart(accountId),
    kind === 'template_preview' ? 'template-previews' : 'media',
    fileName,
  ].join('/');

  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.r2BucketName,
      Key: storageKey,
      Body: file.buffer,
      ContentType: file.mimetype,
      ContentLength: file.size,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  return {
    storageKey,
    url: publicUrlForKey(storageKey),
    fileName,
  };
}

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const accountId = req.auth?.accountId;
    if (accountId === undefined || accountId === null || accountId === '') {
      return res.status(403).json({ message: 'Account is not available for this user.' });
    }

    const kind = normalizeKind(req.query.kind);
    const mediaType = normalizeMediaType(req.query.mediaType);

    // Customer gallery endpoint must never expose internal template-preview assets.
    if (kind !== 'customer') {
      return res.status(403).json({ message: 'Internal template assets are not available in the customer gallery.' });
    }

    const page = Math.max(1, Number(req.query.page || 1) || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query.perPage || 60) || 60));
    const search = String(req.query.search || '').trim();

    const filter: Record<string, any> = {
      accountId,
      kind: 'customer',
      mediaType,
      deletedAt: null,
    };

    if (search) {
      filter.$or = [
        { originalName: { $regex: search, $options: 'i' } },
        { fileName: { $regex: search, $options: 'i' } },
        { altText: { $regex: search, $options: 'i' } },
      ];
    }

    const [items, total] = await Promise.all([
      Media.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage)
        .lean(),
      Media.countDocuments(filter),
    ]);

    return res.json({
      items: items.map(serializeMedia),
      total,
      page,
      perPage,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    const accountId = req.auth?.accountId;
    const userId = req.auth?.userId;
    const businessId = req.auth?.businessId;

    if (accountId === undefined || accountId === null || accountId === '') {
      return res.status(403).json({ message: 'Account is not available for this user.' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded.' });
    }

    const requestedKind = normalizeKind(req.body.kind);
    const mediaType: MediaType = normalizeMediaType(req.body.mediaType);

    // Public/customer upload route cannot create hidden template assets.
    if (requestedKind !== 'customer') {
      return res.status(400).json({ message: 'Customer media upload only accepts kind=customer.' });
    }

    if (mediaType !== 'image') {
      return res.status(400).json({ message: 'This media-library endpoint currently accepts images only.' });
    }

    const uploaded = await uploadImageToR2({
      file: req.file,
      accountId,
      kind: 'customer',
    });

    const item = await Media.create({
      accountId,
      businessId: businessId && Types.ObjectId.isValid(businessId) ? businessId : null,
      uploadedByUserId: userId || null,
      kind: 'customer',
      mediaType: 'image',
      fileName: uploaded.fileName,
      originalName: req.file.originalname || uploaded.fileName,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      storageKey: uploaded.storageKey,
      url: uploaded.url,
      altText: String(req.body.altText || '').trim(),
      deletedAt: null,
    });

    return res.status(201).json({
      message: 'Image uploaded successfully.',
      item: serializeMedia(item.toObject()),
    });
  } catch (error: any) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return next(error);
  }
});

router.post('/template-preview', upload.single('file'), async (req, res, next) => {
  try {
    const accountId = req.auth?.accountId;
    const userId = req.auth?.userId;
    const businessId = req.auth?.businessId;

    if (accountId === undefined || accountId === null || accountId === '') {
      return res.status(403).json({ message: 'Account is not available for this user.' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No template preview image uploaded.' });
    }

    const uploaded = await uploadImageToR2({
      file: req.file,
      accountId,
      kind: 'template_preview',
    });

    const rawTemplateId = String(req.body.templateId || '').trim();
    const sourceTemplateId = Types.ObjectId.isValid(rawTemplateId)
      ? new Types.ObjectId(rawTemplateId)
      : null;

    const item = await Media.create({
      accountId,
      businessId: businessId && Types.ObjectId.isValid(businessId) ? businessId : null,
      uploadedByUserId: userId || null,
      kind: 'template_preview',
      mediaType: 'image',
      fileName: uploaded.fileName,
      originalName: req.file.originalname || uploaded.fileName,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      storageKey: uploaded.storageKey,
      url: uploaded.url,
      sourceTemplateId,
      deletedAt: null,
    });

    return res.status(201).json({
      message: 'Template preview uploaded successfully.',
      item: serializeMedia(item.toObject()),
    });
  } catch (error: any) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const accountId = req.auth?.accountId;
    const id = String(req.params.id || '').trim();

    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid media id.' });
    }

    const item = await Media.findOne({
      _id: id,
      accountId,
      kind: 'customer',
      deletedAt: null,
    });

    if (!item) {
      return res.status(404).json({ message: 'Media not found.' });
    }

    // Soft delete: remove it from the reusable gallery but preserve the R2 object
    // so already-published templates/pages that reference its URL do not break.
    item.deletedAt = new Date();
    await item.save();

    return res.json({
      message: 'Media removed from gallery.',
    });
  } catch (error) {
    return next(error);
  }
});

export default router;

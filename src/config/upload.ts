import {
  PutObjectCommand,
} from '@aws-sdk/client-s3';

import {
  Router,
} from 'express';

import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  env,
} from '../config/env.js';

import {
  s3Client,
} from '../config/r2.js';

const router =
  Router();

const allowedMimeTypes =
  new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
  ]);

const upload =
  multer({
    storage:
      multer.memoryStorage(),

    limits: {
      fileSize:
        5 * 1024 * 1024,
    },

    fileFilter: (
      _req,
      file,
      cb,
    ) => {

      if (
        !allowedMimeTypes.has(
          file.mimetype,
        )
      ) {
        cb(
          new Error(
            'Only JPG, PNG, WEBP and GIF images are allowed.',
          ),
        );

        return;
      }

      cb(
        null,
        true,
      );
    },
  });

const safeExtension = (
  file: Express.Multer.File,
): string => {

  const originalExtension =
    path
      .extname(
        file.originalname,
      )
      .toLowerCase();

  if (
    [
      '.jpg',
      '.jpeg',
      '.png',
      '.webp',
      '.gif',
    ].includes(
      originalExtension,
    )
  ) {
    return originalExtension;
  }

  switch (
    file.mimetype
  ) {
    case 'image/png':
      return '.png';

    case 'image/webp':
      return '.webp';

    case 'image/gif':
      return '.gif';

    default:
      return '.jpg';
  }
};

router.post(
  '/upload',

  upload.single(
    'image',
  ),

  async (
    req,
    res,
  ) => {

    try {

      const file =
        req.file;

      if (!file) {
        return res
          .status(400)
          .json({
            message:
              'No image file uploaded. Use form-data field name "image".',
          });
      }

      const extension =
        safeExtension(
          file,
        );

      const fileKey =
        `uploads/${Date.now()}-${crypto.randomUUID()}${extension}`;

      await s3Client.send(
        new PutObjectCommand({
          Bucket:
            env.r2BucketName,

          Key:
            fileKey,

          Body:
            file.buffer,

          ContentType:
            file.mimetype,

          CacheControl:
            'public, max-age=31536000',
        }),
      );

      const fileUrl =
        env.r2PublicUrl
          ? `${env.r2PublicUrl}/${fileKey}`
          : '';

      return res
        .status(200)
        .json({
          message:
            'File uploaded successfully.',

          key:
            fileKey,

          fileUrl,

          mimeType:
            file.mimetype,

          size:
            file.size,
        });

    } catch (
      error: any
    ) {

      console.error(
        '[R2 UPLOAD ERROR]',
        {
          name:
            error?.name,

          code:
            error?.code,

          message:
            error?.message,

          metadata:
            error?.$metadata,
        },
      );

      return res
        .status(500)
        .json({
          message:
            'Image upload failed.',

          error:
            error?.name ||
            error?.code ||
            'R2UploadError',

          detail:
            process.env.NODE_ENV ===
              'production'
              ? undefined
              : error?.message,
        });
    }
  },
);

export default router;

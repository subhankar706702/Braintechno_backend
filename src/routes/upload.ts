import { Router } from 'express';
import multer from 'multer';
import multerS3 from 'multer-s3';
import { env } from '../config/env';
import { s3Client } from '../config/r2';

const router = Router();

const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: env.r2BucketName,
    metadata: (_req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (_req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const extension = file.originalname.split('.').pop();
      cb(null, `uploads/${uniqueSuffix}.${extension}`);
    },
  }),
});

// Single File Upload Endpoint
router.post('/upload', upload.single('image'), (req, res) => {
  try {
    const file = req.file as any;
    if (!file) {
      return res.status(400).json({ message: 'No file uploaded.' });
    }

    // Cloudflare R2 Public URL framing
    const publicUrl = `${env.r2PublicUrl}/${file.key}`;

    return res.status(200).json({
      message: 'File uploaded successfully!',
      fileUrl: publicUrl,
      key: file.key,
    });
  } catch (error: any) {
    return res.status(500).json({ message: error.message });
  }
});

export default router;
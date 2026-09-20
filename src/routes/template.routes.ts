import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { requireAuth } from '../middleware/auth.js';
import { Page } from '../models/page.model.js';
import { Template } from '../models/template.model.js';
import {
  normalizeLegacyDesign,
  serializeDocument
} from '../utils/serialize.js';

const router = Router();

router.use(requireAuth);

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || `page-${Date.now()}`;

const previewDir = (): string =>
  path.resolve(
    process.cwd(),
    'uploads',
    'template-previews'
  );

/**
 * Normal user:
 * Always use accountId from JWT, even if somebody changes the query string.
 *
 * Admin:
 * May optionally request another account with:
 * ?accountId=BT00001
 *
 * Admin without query defaults to accountId 0.
 */
function resolveListAccountId(req: any): string | number {
  const tokenAccountId = req.auth?.accountId ?? '';

  if (req.auth?.role !== 'admin') {
    return tokenAccountId;
  }

  const rawQuery = req.query?.accountId;

  if (
    rawQuery === undefined ||
    rawQuery === null ||
    String(rawQuery).trim() === ''
  ) {
    return tokenAccountId;
  }

  const value = String(rawQuery).trim();

  if (value === '0') {
    return 0;
  }

  return value;
}

/**
 * Single-template operations are always isolated to the logged-in account.
 */
function queryFor(req: any, id?: string): Record<string, unknown> {
  const query: Record<string, unknown> = {
    accountId: req.auth?.accountId
  };

  if (id) {
    query['_id'] = id;
  }

  return query;
}

async function savePreview(
  id: string,
  dataUrl: unknown
): Promise<{
  previewImage: string;
  previewImageName: string;
} | null> {
  if (
    typeof dataUrl !== 'string' ||
    !dataUrl.startsWith('data:image/jpeg;base64,')
  ) {
    return null;
  }

  const base64 = dataUrl.slice(
    'data:image/jpeg;base64,'.length
  );

  const name = `${id}.jpg`;

  await mkdir(previewDir(), {
    recursive: true
  });

  await writeFile(
    path.join(previewDir(), name),
    Buffer.from(base64, 'base64')
  );

  return {
    previewImage:
      `/uploads/template-previews/${name}`,
    previewImageName: name
  };
}

/**
 * GET /api/templates?accountId=BT00001
 *
 * Normal user:
 * - backend ignores attempts to query another account
 * - JWT accountId is used
 *
 * Admin:
 * - accountId query can be used to inspect a selected account
 */
router.get('/', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const accountId = resolveListAccountId(req);

    const accountFilter = accountId === 0 || accountId === '0'
      ? { $in: [0, '0'] }
      : accountId;

    const items = await Template.find({
      accountId: accountFilter
    })
      .sort({
        updatedAt: -1
      })
      .lean();

    return res.json(
      items.map((item: any) =>
        serializeDocument({
          ...item,
          design: normalizeLegacyDesign(
            item.design
          )
        })
      )
    );
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/templates
 * New template automatically belongs to the JWT account.
 */
router.post('/', async (req, res, next) => {
  try {
    const businessId = req.auth?.businessId;
    const accountId = req.auth?.accountId;

    if (!businessId) {
      return res.status(400).json({
        message:
          'No business is linked to this account.'
      });
    }

    if (
      accountId === undefined ||
      accountId === null ||
      accountId === ''
    ) {
      return res.status(400).json({
        message: 'Account ID is missing.'
      });
    }

    const item = await Template.create({
      accountId,
      businessId,
      name: String(
        req.body?.name ||
        'Untitled Template'
      ).trim(),
      description: String(
        req.body?.description || ''
      ),
      design: normalizeLegacyDesign(
        req.body?.design
      ),
      html: String(
        req.body?.html || ''
      ),
      status:
        req.body?.status === 'published'
          ? 'published'
          : 'draft'
    });

    const preview = await savePreview(
      String(item._id),
      req.body?.previewJpg
    );

    if (preview) {
      item.set(preview);
      await item.save();
    }

    return res
      .status(201)
      .json(
        serializeDocument(
          item.toObject() as any
        )
      );
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/templates/:id
 */
router.get('/:id', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: 'Invalid template id.'
      });
    }

    const item = await Template.findOne(
      queryFor(req, req.params.id)
    ).lean();

    if (!item) {
      return res.status(404).json({
        message: 'Template not found.'
      });
    }

    return res.json(
      serializeDocument({
        ...item,
        design: normalizeLegacyDesign(
          (item as any).design
        )
      } as any)
    );
  } catch (error) {
    return next(error);
  }
});

/**
 * PUT /api/templates/:id
 * Saves JSON + HTML + JPG preview and updates linked page.
 */
router.put('/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: 'Invalid template id.'
      });
    }

    const allowed = {
      name: String(
        req.body?.name ||
        'Untitled Template'
      ).trim(),
      description: String(
        req.body?.description || ''
      ),
      design: normalizeLegacyDesign(
        req.body?.design
      ),
      html: String(
        req.body?.html || ''
      ),
      status: [
        'draft',
        'published',
        'locked'
      ].includes(req.body?.status)
        ? req.body.status
        : 'draft'
    };

    let item = await Template.findOneAndUpdate(
      queryFor(req, req.params.id),
      {
        $set: allowed
      },
      {
        returnDocument: 'after',
        runValidators: true
      }
    );

    if (!item) {
      return res.status(404).json({
        message: 'Template not found.'
      });
    }

    const preview = await savePreview(
      String(item._id),
      req.body?.previewJpg
    );

    if (preview) {
      item.set(preview);
      await item.save();
    }

    const businessId = String(
      item.businessId
    );

    const existingPage = await Page.findOne({
      businessId,
      templateId: item._id
    });

    const pageBase = slugify(
      String(item.name || 'page')
    );

    let pageSlug =
      existingPage?.slug || pageBase;

    if (!existingPage) {
      let suffix = 1;

      while (
        await Page.exists({
          businessId,
          slug: pageSlug
        })
      ) {
        pageSlug = `${pageBase}-${suffix++}`;
      }
    }

    await Page.findOneAndUpdate(
      {
        businessId,
        templateId: item._id
      },
      {
        $set: {
          name: item.name,
          slug: pageSlug,
          description: item.description,
          design: normalizeLegacyDesign(
            item.design
          ),
          html: String(item.html || ''),
          status:
            item.status === 'published'
              ? 'published'
              : 'draft'
        }
      },
      {
        upsert: true,
        returnDocument: 'after',
        setDefaultsOnInsert: true
      }
    );

    return res.json(
      serializeDocument(
        item.toObject() as any
      )
    );
  } catch (error) {
    return next(error);
  }
});

/**
 * DELETE /api/templates/:id
 */
router.delete('/:id', async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: 'Invalid template id.'
      });
    }

    const item = await Template.findOneAndDelete(
      queryFor(req, req.params.id)
    );

    if (!item) {
      return res.status(404).json({
        message: 'Template not found.'
      });
    }

    await Page.deleteMany({
      templateId: item._id,
      businessId: item.businessId
    });

    if (item.previewImageName) {
      try {
        await unlink(
          path.join(
            previewDir(),
            item.previewImageName
          )
        );
      } catch {
        // Preview may already be missing. Template deletion should continue.
      }
    }

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;

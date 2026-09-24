import {
  Router
} from 'express';

import {
  isValidObjectId
} from 'mongoose';

import {
  mkdir,
  unlink,
  writeFile
} from 'node:fs/promises';

import path from 'node:path';

import {
  requireAuth
} from '../middleware/auth.js';

import {
  Page
} from '../models/page.model.js';

import {
  Template
} from '../models/template.model.js';

import {
  normalizeLegacyDesign,
  serializeDocument
} from '../utils/serialize.js';


const router =
  Router();


router.use(
  requireAuth
);


const MASTER_ACCOUNT_ID =
  '0';


const GALLERY_CATEGORIES = [
  'new',
  'locked',
  'free',
  'coming_soon'
] as const;


type GalleryCategory =
  typeof GALLERY_CATEGORIES[number];


const slugify = (
  value: string
): string =>
  value
    .toLowerCase()
    .trim()
    .replace(
      /[^a-z0-9]+/g,
      '-'
    )
    .replace(
      /^-|-$/g,
      ''
    ) ||
  `page-${Date.now()}`;


const previewDir =
  (): string =>
    path.resolve(
      process.cwd(),
      'uploads',
      'template-previews'
    );


const isMasterAccountId = (
  value: unknown
): boolean =>
  String(
    value ?? ''
  ).trim() ===
  MASTER_ACCOUNT_ID;


const currentAccountId = (
  req: any
): string =>
  String(
    req.auth?.accountId ??
    ''
  ).trim();


const isAdmin = (
  req: any
): boolean =>
  req.auth?.role ===
  'admin';


const normalizeTemplateType = (
  value: unknown
): number => {

  const number =
    Number(value);

  if (
    !Number.isFinite(number) ||
    number < 0
  ) {
    return 0;
  }

  return Math.trunc(
    number
  );
};


const normalizeGalleryCategory = (
  value: unknown
): GalleryCategory => {

  const category =
    String(
      value ??
      ''
    ).trim() as
      GalleryCategory;

  return GALLERY_CATEGORIES
    .includes(category)
      ? category
      : 'free';
};


/**
 * LIST permission
 *
 * Normal user:
 * - may read own templates
 * - may read accountId 0 gallery templates
 * - may NOT read another business account
 *
 * Admin:
 * - may read any account
 */
const resolveListAccountId = (
  req: any
):
  string |
  number => {

  const ownAccountId =
    currentAccountId(req);

  const raw =
    req.query?.accountId;

  if (
    raw === undefined ||
    raw === null ||
    String(raw).trim() ===
      ''
  ) {
    return ownAccountId;
  }

  const requested =
    String(raw).trim();


  if (
    requested ===
    MASTER_ACCOUNT_ID
  ) {
    return 0;
  }


  if (isAdmin(req)) {
    return requested;
  }


  return ownAccountId;
};


/**
 * READ permission for one template:
 * - own template
 * - master gallery template (accountId 0)
 * - admin can read any template
 */
const readQueryFor = (
  req: any,
  id: string
): Record<
  string,
  unknown
> => {

  if (isAdmin(req)) {
    return {
      _id: id
    };
  }

  return {
    _id: id,
    $or: [
      {
        accountId:
          req.auth?.accountId
      },
      {
        accountId: {
          $in: [
            0,
            MASTER_ACCOUNT_ID
          ]
        }
      }
    ]
  };
};


/**
 * WRITE permission for one template:
 *
 * Normal user:
 * - own templates only
 *
 * Admin:
 * - any template, including master accountId 0
 */
const writeQueryFor = (
  req: any,
  id: string
): Record<
  string,
  unknown
> => {

  if (isAdmin(req)) {
    return {
      _id: id
    };
  }

  return {
    _id: id,
    accountId:
      req.auth?.accountId
  };
};


async function savePreview(
  id: string,
  dataUrl: unknown
): Promise<{
  previewImage: string;
  previewImageName: string;
} | null> {

  if (
    typeof dataUrl !==
      'string' ||
    !dataUrl.startsWith(
      'data:image/jpeg;base64,'
    )
  ) {
    return null;
  }


  const base64 =
    dataUrl.slice(
      'data:image/jpeg;base64,'
        .length
    );


  const name =
    `${id}.jpg`;


  await mkdir(
    previewDir(),
    {
      recursive: true
    }
  );


  await writeFile(
    path.join(
      previewDir(),
      name
    ),
    Buffer.from(
      base64,
      'base64'
    )
  );


  return {
    previewImage:
      `/uploads/template-previews/${name}`,

    previewImageName:
      name
  };
}


/**
 * GET /api/templates
 * GET /api/templates?accountId=0
 *
 * Normal users are allowed to read accountId 0 because
 * that is the public authenticated template gallery.
 */
router.get(
  '/',
  async (
    req,
    res,
    next
  ) => {

    try {

      res.set(
        'Cache-Control',
        'no-store'
      );


      const accountId =
        resolveListAccountId(
          req
        );


      const accountFilter =
        isMasterAccountId(
          accountId
        )
          ? {
              $in: [
                0,
                MASTER_ACCOUNT_ID
              ]
            }
          : accountId;


      const filter:
        Record<
          string,
          unknown
        > = {
          accountId:
            accountFilter
        };


      /**
       * Optional server-side filters.
       * Frontend can still filter locally.
       */
      const type =
        req.query
          ?.templateType;

      if (
        type !== undefined &&
        type !== null &&
        String(type).trim() !==
          ''
      ) {
        filter['templateType'] =
          normalizeTemplateType(
            type
          );
      }


      const category =
        req.query
          ?.galleryCategory;

      if (
        category !== undefined &&
        category !== null &&
        String(category).trim() !==
          ''
      ) {
        filter['galleryCategory'] =
          normalizeGalleryCategory(
            category
          );
      }


      const search =
        String(
          req.query?.search ??
          ''
        ).trim();

      if (search) {
        filter['$or'] = [
          {
            name: {
              $regex: search,
              $options: 'i'
            }
          },
          {
            description: {
              $regex: search,
              $options: 'i'
            }
          }
        ];
      }


      const items =
        await Template.find(
          filter
        )
          .sort({
            updatedAt: -1
          })
          .lean();


      return res.json(
        items.map(
          (item: any) =>
            serializeDocument({
              ...item,

              design:
                normalizeLegacyDesign(
                  item.design
                )
            })
        )
      );

    } catch (error) {

      return next(error);

    }
  }
);


/**
 * POST /api/templates
 *
 * Normal user:
 * - backend ALWAYS uses JWT accountId
 * - cannot create accountId 0 master templates
 *
 * Admin:
 * - may explicitly send accountId: 0
 * - master template is saved with accountId 0
 */
router.post(
  '/',
  async (
    req,
    res,
    next
  ) => {

    try {

      const tokenAccountId =
        currentAccountId(req);


      if (!tokenAccountId) {

        return res
          .status(400)
          .json({
            message:
              'Account ID is missing.'
          });

      }


      const requestedAccountId =
        req.body?.accountId;


      const wantsMasterTemplate =
        isMasterAccountId(
          requestedAccountId
        );


      if (
        wantsMasterTemplate &&
        !isAdmin(req)
      ) {

        return res
          .status(403)
          .json({
            message:
              'Only admin can create gallery templates.'
          });

      }


      const accountId =
        wantsMasterTemplate
          ? 0
          : tokenAccountId;


      const isMaster =
        isMasterAccountId(
          accountId
        );


      const businessId =
        isMaster
          ? null
          : (
              req.auth
                ?.businessId ??
              null
            );


      if (
        !isMaster &&
        !businessId
      ) {

        return res
          .status(400)
          .json({
            message:
              'No business is linked to this account.'
          });

      }


      const status =
        [
          'draft',
          'published',
          'locked'
        ].includes(
          req.body?.status
        )
          ? req.body.status
          : 'draft';


      const item =
        await Template.create({
          accountId,
          businessId,

          name:
            String(
              req.body?.name ||
              'Untitled Template'
            ).trim(),

          description:
            String(
              req.body
                ?.description ||
              ''
            ),

          design:
            normalizeLegacyDesign(
              req.body?.design
            ),

          html:
            String(
              req.body?.html ||
              ''
            ),

          status,

          templateType:
            isMaster
              ? normalizeTemplateType(
                  req.body
                    ?.templateType
                )
              : 0,

          galleryCategory:
            isMaster
              ? normalizeGalleryCategory(
                  req.body
                    ?.galleryCategory
                )
              : 'free'
        });


      const preview =
        await savePreview(
          String(item._id),
          req.body?.previewJpg
        );


      if (preview) {

        item.set(
          preview
        );

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
  }
);


/**
 * GET /api/templates/:id
 *
 * User can view:
 * - own template
 * - gallery template accountId 0
 */
router.get(
  '/:id',
  async (
    req,
    res,
    next
  ) => {

    try {

      res.set(
        'Cache-Control',
        'no-store'
      );


      if (
        !isValidObjectId(
          req.params.id
        )
      ) {

        return res
          .status(400)
          .json({
            message:
              'Invalid template id.'
          });

      }


      const item =
        await Template.findOne(
          readQueryFor(
            req,
            req.params.id
          )
        )
          .lean();


      if (!item) {

        return res
          .status(404)
          .json({
            message:
              'Template not found.'
          });

      }


      return res.json(
        serializeDocument({
          ...item,

          design:
            normalizeLegacyDesign(
              (item as any)
                .design
            )
        } as any)
      );

    } catch (error) {

      return next(error);

    }
  }
);


/**
 * PUT /api/templates/:id
 *
 * Normal user:
 * - can update own template only
 *
 * Admin:
 * - can update master gallery templates
 * - templateType/galleryCategory are accepted only
 *   for accountId 0
 */
router.put(
  '/:id',
  async (
    req,
    res,
    next
  ) => {

    try {

      if (
        !isValidObjectId(
          req.params.id
        )
      ) {

        return res
          .status(400)
          .json({
            message:
              'Invalid template id.'
          });

      }


      const existing =
        await Template.findOne(
          writeQueryFor(
            req,
            req.params.id
          )
        );


      if (!existing) {

        return res
          .status(404)
          .json({
            message:
              'Template not found.'
          });

      }


      const master =
        isMasterAccountId(
          existing.accountId
        );


      if (
        master &&
        !isAdmin(req)
      ) {

        return res
          .status(403)
          .json({
            message:
              'Only admin can update gallery templates.'
          });

      }


      const allowed:
        Record<
          string,
          unknown
        > = {

        name:
          String(
            req.body?.name ||
            'Untitled Template'
          ).trim(),

        description:
          String(
            req.body
              ?.description ||
            ''
          ),

        design:
          normalizeLegacyDesign(
            req.body?.design
          ),

        html:
          String(
            req.body?.html ||
            ''
          ),

        status:
          [
            'draft',
            'published',
            'locked'
          ].includes(
            req.body?.status
          )
            ? req.body.status
            : 'draft'
      };


      if (master) {

        allowed[
          'templateType'
        ] =
          normalizeTemplateType(
            req.body
              ?.templateType ??
            existing
              .templateType
          );


        allowed[
          'galleryCategory'
        ] =
          normalizeGalleryCategory(
            req.body
              ?.galleryCategory ??
            existing
              .galleryCategory
          );

      }


      let item =
        await Template
          .findOneAndUpdate(
            {
              _id:
                existing._id
            },
            {
              $set:
                allowed
            },
            {
              returnDocument:
                'after',
              runValidators:
                true
            }
          );


      if (!item) {

        return res
          .status(404)
          .json({
            message:
              'Template not found.'
          });

      }


      const preview =
        await savePreview(
          String(item._id),
          req.body?.previewJpg
        );


      if (preview) {

        item.set(
          preview
        );

        await item.save();

      }


      /**
       * Master gallery templates do NOT create/update
       * a Business Page because businessId is intentionally null.
       */
      if (
        !master &&
        item.businessId
      ) {

        const businessId =
          String(
            item.businessId
          );


        const existingPage =
          await Page.findOne({
            businessId,
            templateId:
              item._id
          });


        const pageBase =
          slugify(
            String(
              item.name ||
              'page'
            )
          );


        let pageSlug =
          existingPage?.slug ||
          pageBase;


        if (!existingPage) {

          let suffix = 1;

          while (
            await Page.exists({
              businessId,
              slug:
                pageSlug
            })
          ) {

            pageSlug =
              `${pageBase}-${suffix++}`;

          }
        }


        await Page
          .findOneAndUpdate(
            {
              businessId,
              templateId:
                item._id
            },
            {
              $set: {
                name:
                  item.name,

                slug:
                  pageSlug,

                description:
                  item.description,

                design:
                  normalizeLegacyDesign(
                    item.design
                  ),

                html:
                  String(
                    item.html ||
                    ''
                  ),

                status:
                  item.status ===
                  'published'
                    ? 'published'
                    : 'draft'
              }
            },
            {
              upsert: true,

              returnDocument:
                'after',

              setDefaultsOnInsert:
                true
            }
          );

      }


      return res.json(
        serializeDocument(
          item.toObject() as any
        )
      );

    } catch (error) {

      return next(error);

    }
  }
);


/**
 * DELETE /api/templates/:id
 *
 * Normal user:
 * - own template only
 *
 * Admin:
 * - any template, including accountId 0
 */
router.delete(
  '/:id',
  async (
    req,
    res,
    next
  ) => {

    try {

      if (
        !isValidObjectId(
          req.params.id
        )
      ) {

        return res
          .status(400)
          .json({
            message:
              'Invalid template id.'
          });

      }


      const existing =
        await Template.findOne(
          writeQueryFor(
            req,
            req.params.id
          )
        );


      if (!existing) {

        return res
          .status(404)
          .json({
            message:
              'Template not found.'
          });

      }


      const master =
        isMasterAccountId(
          existing.accountId
        );


      if (
        master &&
        !isAdmin(req)
      ) {

        return res
          .status(403)
          .json({
            message:
              'Only admin can delete gallery templates.'
          });

      }


      const item =
        await Template
          .findOneAndDelete({
            _id:
              existing._id
          });


      if (!item) {

        return res
          .status(404)
          .json({
            message:
              'Template not found.'
          });

      }


      if (
        item.businessId
      ) {

        await Page.deleteMany({
          templateId:
            item._id,

          businessId:
            item.businessId
        });

      }


      if (
        item.previewImageName
      ) {

        try {

          await unlink(
            path.join(
              previewDir(),
              item
                .previewImageName
            )
          );

        } catch {

          // Missing preview must not block template deletion.

        }
      }


      return res
        .status(204)
        .send();

    } catch (error) {

      return next(error);

    }
  }
);


export default router;

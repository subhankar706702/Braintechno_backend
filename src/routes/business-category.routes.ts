import {
  Router,
} from 'express';

import {
  BusinessCategory,
} from '../models/business-category.model.js';

const router =
  Router();

router.get(
  '/',
  async (
    _req,
    res,
    next,
  ) => {
    try {
      const categories =
        await BusinessCategory
          .find({
            isActive: true,
          })
          .sort({
            sortOrder: 1,
            typeId: 1,
          })
          .select({
            _id: 0,
            typeId: 1,
            name: 1,
          })
          .lean();

      return res.json({
        data: categories,
      });
    } catch (error) {
      return next(error);
    }
  },
);

router.get(
  '/:typeId',
  async (
    req,
    res,
    next,
  ) => {
    try {
      const typeId =
        Number(req.params.typeId);

      if (
        !Number.isFinite(typeId)
      ) {
        return res
          .status(400)
          .json({
            message:
              'Invalid business category typeId.',
          });
      }

      const category =
        await BusinessCategory
          .findOne({
            typeId,
            isActive: true,
          })
          .select({
            _id: 0,
            typeId: 1,
            name: 1,
          })
          .lean();

      if (!category) {
        return res
          .status(404)
          .json({
            message:
              'Business category not found.',
          });
      }

      return res.json({
        data: category,
      });
    } catch (error) {
      return next(error);
    }
  },
);

export default router;

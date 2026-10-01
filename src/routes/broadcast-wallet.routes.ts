import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { User } from '../models/user.model.js';
import { BroadcastWallet } from '../models/broadcast-wallet.model.js';

const router = Router();
router.use(requireAuth);

const clean = (value: unknown): string => String(value ?? '').trim();

router.get('/', async (req, res, next) => {
  try {
    const businessId = clean(req.auth?.businessId);
    if (!businessId) return res.status(401).json({ message: 'Business account is not available.' });

    const user = await User.findOne({ businessId }).select('accountId').lean();
    const accountId = clean(user?.accountId);
    if (!accountId) return res.status(409).json({ message: 'Business account is not configured.' });

    const wallet = await BroadcastWallet.findOneAndUpdate(
      { accountId },
      { $setOnInsert: { accountId, businessId } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();

    return res.json({
      WhatsApp: Number(wallet?.WhatsApp ?? 0),
      SMS: Number(wallet?.SMS ?? 0),
      Email: Number(wallet?.Email ?? 0),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;

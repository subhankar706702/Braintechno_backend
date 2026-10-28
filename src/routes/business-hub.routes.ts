import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { BusinessHubTransaction, BUSINESS_TRANSACTION_TYPES, BUSINESS_TRANSACTION_PAYMENT_METHODS } from '../models/business-hub-transaction.model.js';
import { BusinessHubStock, STOCK_UNITS } from '../models/business-hub-stock.model.js';

const router = Router();
router.use(requireAuth);

const cleanText = (value: unknown): string => String(value ?? '').trim();
const money = (value: unknown): number => Math.round(Number(value) * 100) / 100;

function getTodayInIndia(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function startDateForPeriod(period: string, today: string): string {
  const [year, month, day] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (period === 'week') {
    const weekday = date.getUTCDay();
    date.setUTCDate(date.getUTCDate() - ((weekday + 6) % 7));
  } else if (period === 'month') {
    date.setUTCDate(1);
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function publicTransaction(item: any) {
  return {
    id: String(item._id),
    type: item.type,
    entryDate: item.entryDate,
    category: item.category,
    amount: item.amount,
    paymentMethod: item.paymentMethod,
    note: item.note ?? '',
    createdAt: item.createdAt,
  };
}

function accountContext(req: Request, res: Response): { accountId: string; userId: string } | null {
  const accountId = cleanText(req.auth?.accountId);
  const userId = cleanText(req.auth?.userId);
  if (!accountId || !userId) {
    res.status(409).json({ message: 'Your account is missing an account ID. Please sign in again or contact support.' });
    return null;
  }
  return { accountId, userId };
}

router.get('/transactions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const context = accountContext(req, res);
    if (!context) return;

    const requestedPeriod = cleanText(req.query.period || 'day');
    const period = ['day', 'week', 'month'].includes(requestedPeriod) ? requestedPeriod : 'day';
    const today = getTodayInIndia();
    const startDate = startDateForPeriod(period, today);

    const items = await BusinessHubTransaction.find({
      accountId: context.accountId,
      entryDate: { $gte: startDate, $lte: today },
    }).sort({ entryDate: -1, createdAt: -1 }).limit(500).lean();

    const summary = items.reduce((total: { sales: number; expenses: number; net: number; count: number }, item: any) => {
      const amount = Number(item.amount) || 0;
      if (item.type === 'sale') total.sales += amount;
      else total.expenses += amount;
      total.count += 1;
      return total;
    }, { sales: 0, expenses: 0, net: 0, count: 0 });
    summary.sales = money(summary.sales);
    summary.expenses = money(summary.expenses);
    summary.net = money(summary.sales - summary.expenses);

    res.json({ items: items.map(publicTransaction), summary, period, startDate, endDate: today });
  } catch (error) {
    next(error);
  }
});

router.post('/transactions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const context = accountContext(req, res);
    if (!context) return;

    const type = cleanText(req.body?.type);
    const entryDate = cleanText(req.body?.entryDate);
    const category = cleanText(req.body?.category);
    const amount = Number(req.body?.amount);
    const paymentMethod = cleanText(req.body?.paymentMethod || 'Cash');
    const note = cleanText(req.body?.note);
    const today = getTodayInIndia();

    if (!(BUSINESS_TRANSACTION_TYPES as readonly string[]).includes(type)) {
      res.status(400).json({ message: 'Choose Sale or Expense.' }); return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate) || entryDate > today) {
      res.status(400).json({ message: 'Enter a valid date that is not in the future.' }); return;
    }
    if (!category || category.length > 80) {
      res.status(400).json({ message: 'Enter a category up to 80 characters.' }); return;
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000000) {
      res.status(400).json({ message: 'Enter a valid amount greater than zero.' }); return;
    }
    if (!(BUSINESS_TRANSACTION_PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
      res.status(400).json({ message: 'Choose a valid payment method.' }); return;
    }
    if (note.length > 500) {
      res.status(400).json({ message: 'Note must be 500 characters or fewer.' }); return;
    }

    const created = await BusinessHubTransaction.create({
      accountId: context.accountId,
      userId: context.userId,
      type,
      entryDate,
      category,
      amount: money(amount),
      paymentMethod,
      note,
    });
    res.status(201).json(publicTransaction(created));
  } catch (error) {
    next(error);
  }
});


function publicStock(item: any) {
  const threshold = item.lowStockThreshold == null ? 5 : Number(item.lowStockThreshold);
  const quantity = Number(item.quantity) || 0;
  return { id: String(item._id), name: item.name, description: item.description ?? '', sku: item.sku ?? '', imageUrl: item.imageUrl ?? '', originalPrice: item.originalPrice, discountPrice: item.discountPrice, gstEnabled: Boolean(item.gstEnabled), gstRate: item.gstRate ?? 0, quantity, unit: item.unit, lowStockThreshold: item.lowStockThreshold ?? null, stockStatus: quantity <= 0 ? 'out-of-stock' : quantity <= threshold ? 'low-stock' : 'in-stock', createdAt: item.createdAt, updatedAt: item.updatedAt };
}

router.get('/stock', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const context = accountContext(req, res); if (!context) return;
    const search = cleanText(req.query.search).slice(0, 100);
    const status = cleanText(req.query.status || 'all');
    const query: any = { accountId: context.accountId };
    if (search) query.$or = [{ name: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { sku: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }];
    let items = await BusinessHubStock.find(query).sort({ updatedAt: -1 }).limit(1000).lean();
    let mapped = items.map(publicStock);
    if (status === 'low-stock') mapped = mapped.filter((x: any) => x.stockStatus === 'low-stock');
    if (status === 'out-of-stock') mapped = mapped.filter((x: any) => x.stockStatus === 'out-of-stock');
    res.json({ items: mapped, total: mapped.length });
  } catch (error) { next(error); }
});

router.post('/stock', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const context = accountContext(req, res); if (!context) return;
    const body = req.body ?? {};
    const name = cleanText(body.name), description = cleanText(body.description), sku = cleanText(body.sku), imageUrl = cleanText(body.imageUrl);
    const originalPrice = Number(body.originalPrice), discountPrice = Number(body.discountPrice), quantity = Number(body.quantity);
    const gstEnabled = Boolean(body.gstEnabled), gstRate = Number(body.gstRate ?? 0), unit = cleanText(body.unit || 'piece');
    const lowStockThreshold = body.lowStockThreshold === '' || body.lowStockThreshold == null ? null : Number(body.lowStockThreshold);
    if (!name || name.length > 120) { res.status(400).json({ message: 'Product name is required (up to 120 characters).' }); return; }
    if (description.length > 1000 || sku.length > 60 || imageUrl.length > 2000) { res.status(400).json({ message: 'Description, SKU or image URL is too long.' }); return; }
    if (![originalPrice, discountPrice, quantity, gstRate].every(Number.isFinite) || originalPrice < 0 || discountPrice < 0 || quantity < 0 || gstRate < 0 || gstRate > 100) { res.status(400).json({ message: 'Enter valid prices, quantity and GST rate.' }); return; }
    if (discountPrice > originalPrice) { res.status(400).json({ message: 'Discount price cannot exceed original price.' }); return; }
    if (!(STOCK_UNITS as readonly string[]).includes(unit)) { res.status(400).json({ message: 'Choose a valid unit.' }); return; }
    if (lowStockThreshold !== null && (!Number.isFinite(lowStockThreshold) || lowStockThreshold < 0)) { res.status(400).json({ message: 'Low-stock threshold must be zero or more.' }); return; }
    const created = await BusinessHubStock.create({ accountId: context.accountId, userId: context.userId, name, description, sku, imageUrl, originalPrice, discountPrice, gstEnabled, gstRate: gstEnabled ? gstRate : 0, quantity, unit, lowStockThreshold });
    res.status(201).json(publicStock(created));
  } catch (error) { next(error); }
});

router.patch('/stock/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const context = accountContext(req, res); if (!context) return;
    const allowed = ['name','description','sku','imageUrl','originalPrice','discountPrice','gstEnabled','gstRate','quantity','unit','lowStockThreshold'];
    const update: any = {};
    for (const key of allowed) if (Object.prototype.hasOwnProperty.call(req.body ?? {}, key)) update[key] = req.body[key];
    if (typeof update.name === 'string') update.name = update.name.trim();
    if (update.name !== undefined && (!update.name || update.name.length > 120)) { res.status(400).json({ message: 'Enter a valid product name.' }); return; }
    for (const key of ['originalPrice','discountPrice','quantity','gstRate']) if (update[key] !== undefined) { update[key] = Number(update[key]); if (!Number.isFinite(update[key]) || update[key] < 0) { res.status(400).json({ message: `Enter a valid ${key}.` }); return; } }
    if (update.originalPrice !== undefined && update.discountPrice !== undefined && update.discountPrice > update.originalPrice) { res.status(400).json({ message: 'Discount price cannot exceed original price.' }); return; }
    if (update.unit !== undefined && !(STOCK_UNITS as readonly string[]).includes(update.unit)) { res.status(400).json({ message: 'Choose a valid unit.' }); return; }
    if (update.gstEnabled === false) update.gstRate = 0;
    const saved = await BusinessHubStock.findOneAndUpdate({ _id: req.params.id, accountId: context.accountId }, { $set: update }, { new: true, runValidators: true });
    if (!saved) { res.status(404).json({ message: 'Product not found.' }); return; }
    res.json(publicStock(saved));
  } catch (error) { next(error); }
});

router.delete('/stock/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const context = accountContext(req, res); if (!context) return;
    const deleted = await BusinessHubStock.findOneAndDelete({ _id: req.params.id, accountId: context.accountId });
    if (!deleted) { res.status(404).json({ message: 'Product not found.' }); return; }
    res.json({ success: true, id: String(deleted._id) });
  } catch (error) { next(error); }
});

export default router;

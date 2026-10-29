import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { BusinessHubTransaction, BUSINESS_TRANSACTION_TYPES, BUSINESS_TRANSACTION_PAYMENT_METHODS } from '../models/business-hub-transaction.model.js';
import { BusinessHubStock, STOCK_UNITS } from '../models/business-hub-stock.model.js';
import { BusinessHubSettings } from '../models/business-hub-settings.model.js';

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


async function ensureHubSettings(accountId: string) {
  // Keep the insert and increment operations separate to avoid MongoDB path conflicts.
  try {
    await BusinessHubSettings.updateOne(
      { accountId },
      { $setOnInsert: { accountId, skuPrefix: 'BT', nextSkuNumber: 1, skuNumberPadding: 4, defaultLowStockThreshold: 5 } },
      { upsert: true, setDefaultsOnInsert: true },
    );
  } catch (error: any) {
    // A parallel first request may create the unique account settings first.
    if (error?.code !== 11000) throw error;
  }
  const settings = await BusinessHubSettings.findOne({ accountId }).lean();
  if (!settings) throw new Error('Could not load Business Hub settings.');
  return settings;
}

function formatSku(prefix: string, number: number, padding: number): string {
  return `${prefix}${String(number).padStart(padding, '0')}`;
}

function publicStock(item: any, defaultThreshold = 5) {
  const threshold = item.lowStockThreshold == null ? defaultThreshold : Number(item.lowStockThreshold);
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
    const settings = await ensureHubSettings(context.accountId);
    let items = await BusinessHubStock.find(query).sort({ updatedAt: -1 }).limit(1000).lean();
    let mapped = items.map((item: any) => publicStock(item, Number(settings.defaultLowStockThreshold ?? 5)));
    if (status === 'low-stock') mapped = mapped.filter((x: any) => x.stockStatus === 'low-stock');
    if (status === 'out-of-stock') mapped = mapped.filter((x: any) => x.stockStatus === 'out-of-stock');
    res.json({ items: mapped, total: mapped.length });
  } catch (error) { next(error); }
});

router.post('/stock', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const context = accountContext(req, res); if (!context) return;
    const body = req.body ?? {};
    const name = cleanText(body.name);
    const description = cleanText(body.description);
    const imageUrl = cleanText(body.imageUrl);
    const originalPrice = Number(body.originalPrice), discountPrice = Number(body.discountPrice), quantity = Number(body.quantity);
    const gstEnabled = Boolean(body.gstEnabled), gstRate = Number(body.gstRate ?? 0), unit = cleanText(body.unit || 'piece');

    if (!name || name.length > 120) { res.status(400).json({ message: 'Product name is required (up to 120 characters).' }); return; }
    if (description.length > 1000 || imageUrl.length > 2000) { res.status(400).json({ message: 'Description or image URL is too long.' }); return; }
    if (![originalPrice, discountPrice, quantity, gstRate].every(Number.isFinite) || originalPrice < 0 || discountPrice < 0 || quantity < 0 || gstRate < 0 || gstRate > 100) { res.status(400).json({ message: 'Enter valid prices, quantity and GST rate.' }); return; }
    if (discountPrice > originalPrice) { res.status(400).json({ message: 'Discount price cannot exceed original price.' }); return; }
    if (!(STOCK_UNITS as readonly string[]).includes(unit)) { res.status(400).json({ message: 'Choose a valid unit.' }); return; }

    // SKU is generated on the server and is never accepted from the client.
    const settings = await ensureHubSettings(context.accountId);
    const allocated = await BusinessHubSettings.findOneAndUpdate(
      { accountId: context.accountId },
      { $inc: { nextSkuNumber: 1 } },
      { new: false, runValidators: true },
    ).lean();
    if (!allocated) { res.status(500).json({ message: 'Could not generate a product SKU.' }); return; }
    const sku = formatSku(String(allocated.skuPrefix || settings.skuPrefix || 'BT'), Number(allocated.nextSkuNumber), Number(allocated.skuNumberPadding || settings.skuNumberPadding || 4));
    const created = await BusinessHubStock.create({
      accountId: context.accountId, userId: context.userId, name, description, sku, imageUrl,
      originalPrice: money(originalPrice), discountPrice: money(discountPrice), gstEnabled,
      gstRate: gstEnabled ? gstRate : 0, quantity, unit, lowStockThreshold: null,
    });
    res.status(201).json(publicStock(created, Number(settings.defaultLowStockThreshold ?? 5)));
  } catch (error: any) {
    if (error?.code === 11000) { res.status(409).json({ message: 'A duplicate SKU was detected. Please try again.' }); return; }
    next(error);
  }
});

router.patch('/stock/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const context = accountContext(req, res); if (!context) return;
    const allowed = ['name', 'description', 'sku', 'imageUrl', 'originalPrice', 'discountPrice', 'gstEnabled', 'gstRate', 'quantity', 'unit', 'lowStockThreshold'];
    const update: any = {};
    for (const key of allowed) if (Object.prototype.hasOwnProperty.call(req.body ?? {}, key)) update[key] = req.body[key];
    if (typeof update.name === 'string') update.name = update.name.trim();
    if (update.name !== undefined && (!update.name || update.name.length > 120)) { res.status(400).json({ message: 'Enter a valid product name.' }); return; }
    for (const key of ['originalPrice', 'discountPrice', 'quantity', 'gstRate']) if (update[key] !== undefined) { update[key] = Number(update[key]); if (!Number.isFinite(update[key]) || update[key] < 0) { res.status(400).json({ message: `Enter a valid ${key}.` }); return; } }
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




const DEFAULT_HUB_SETTINGS = {
  skuPrefix: 'BT',
  nextSkuNumber: 1,
  skuNumberPadding: 4,
  defaultLowStockThreshold: 5,
};

router.get('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const context = accountContext(req, res); if (!context) return;
    const settings = await ensureHubSettings(context.accountId);
    res.json({
      skuPrefix: settings.skuPrefix,
      nextSkuNumber: settings.nextSkuNumber,
      skuNumberPadding: settings.skuNumberPadding,
      defaultLowStockThreshold: settings.defaultLowStockThreshold,
    });
  } catch (error) { next(error); }
});

router.patch('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const context = accountContext(req, res); if (!context) return;
    const body = req.body ?? {};
    const current = await ensureHubSettings(context.accountId);
    const update: Record<string, unknown> = {};

    if (Object.hasOwn(body, 'skuPrefix')) {
      const prefix = cleanText(body.skuPrefix);
      if (!prefix || prefix.length > 12 || !/^[A-Za-z0-9_-]+$/.test(prefix)) {
        res.status(400).json({ message: 'SKU prefix must contain 1–12 letters, numbers, _ or -.' }); return;
      }
      update['skuPrefix'] = prefix;
    }
    if (Object.hasOwn(body, 'skuNumberPadding')) {
      const padding = Number(body.skuNumberPadding);
      if (!Number.isInteger(padding) || padding < 1 || padding > 10) {
        res.status(400).json({ message: 'SKU padding must be between 1 and 10.' }); return;
      }
      update['skuNumberPadding'] = padding;
    }
    if (Object.hasOwn(body, 'defaultLowStockThreshold')) {
      const threshold = Number(body.defaultLowStockThreshold);
      if (!Number.isFinite(threshold) || threshold < 0) {
        res.status(400).json({ message: 'Low-stock threshold must be zero or more.' }); return;
      }
      update['defaultLowStockThreshold'] = threshold;
    }
    if (Object.hasOwn(body, 'nextSkuNumber')) {
      const nextNumber = Number(body.nextSkuNumber);
      if (!Number.isSafeInteger(nextNumber) || nextNumber < 1) {
        res.status(400).json({ message: 'Starting SKU number must be a positive whole number.' }); return;
      }
      const existingStock = await BusinessHubStock.exists({ accountId: context.accountId });
      if (existingStock) {
        res.status(409).json({ message: 'Starting SKU number cannot be changed after stock products have been created.' }); return;
      }
      update['nextSkuNumber'] = nextNumber;
    }

    // Do not combine $set and $setOnInsert for overlapping settings fields.
    const saved = Object.keys(update).length
      ? await BusinessHubSettings.findOneAndUpdate(
          { accountId: context.accountId }, { $set: update }, { new: true, runValidators: true },
        ).lean()
      : current;
    if (!saved) { res.status(500).json({ message: 'Could not save Business Hub settings.' }); return; }
    res.json({
      skuPrefix: saved.skuPrefix,
      nextSkuNumber: saved.nextSkuNumber,
      skuNumberPadding: saved.skuNumberPadding,
      defaultLowStockThreshold: saved.defaultLowStockThreshold,
    });
  } catch (error) { next(error); }
});



router.post('/invoices/preview', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const context = accountContext(req, res);
    if (!context) return;

    const body = req.body ?? {};
    const rawItems = body.items;

    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      res.status(400).json({ message: 'Add at least one product to the invoice.' });
      return;
    }

    if (rawItems.length > 100) {
      res.status(400).json({ message: 'An invoice cannot contain more than 100 product lines.' });
      return;
    }

    const seen = new Set<string>();
    let subtotal = 0;
    let discountTotal = 0;
    let gstTotal = 0;
    const items: any[] = [];

    for (const raw of rawItems) {
      const stockItemId = cleanText(raw?.stockItemId);
      const quantity = Number(raw?.quantity);
      const unitPrice = Number(raw?.unitPrice);
      const discountPercent = Number(raw?.discountPercent ?? 0);

      if (!/^[a-f\d]{24}$/i.test(stockItemId)) {
        res.status(400).json({ message: 'A product ID is invalid.' });
        return;
      }

      if (seen.has(stockItemId)) {
        res.status(400).json({ message: 'Each product should appear only once in the invoice.' });
        return;
      }
      seen.add(stockItemId);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        res.status(400).json({ message: 'Product quantity must be greater than zero.' });
        return;
      }

      if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 100000000000) {
        res.status(400).json({ message: 'Enter a valid product price.' });
        return;
      }

      if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
        res.status(400).json({ message: 'Discount must be between 0 and 100 percent.' });
        return;
      }

      const stock = await BusinessHubStock.findOne({
        _id: stockItemId,
        accountId: context.accountId,
      }).lean();

      if (!stock) {
        res.status(404).json({
          message: 'A selected product was not found in your stock.',
          stockItemId,
        });
        return;
      }

      if (quantity > Number(stock.quantity)) {
        res.status(409).json({
          message: `Insufficient stock for ${stock.name}. Available: ${stock.quantity} ${stock.unit}.`,
          stockItemId,
          availableQuantity: stock.quantity,
        });
        return;
      }

      const lineSubtotal = money(quantity * unitPrice);
      const lineDiscount = money(lineSubtotal * discountPercent / 100);
      const taxable = money(lineSubtotal - lineDiscount);
      const gstEnabled = Boolean(stock.gstEnabled);
      const gstRate = gstEnabled ? Number(stock.gstRate) || 0 : 0;
      const lineTax = gstEnabled ? money(taxable * gstRate / 100) : 0;
      const lineTotal = money(taxable + lineTax);

      subtotal += lineSubtotal;
      discountTotal += lineDiscount;
      gstTotal += lineTax;

      items.push({
        stockItemId: String(stock._id),
        name: stock.name,
        description: stock.description ?? '',
        sku: stock.sku ?? '',
        quantity,
        unit: stock.unit,
        unitPrice,
        discountPercent,
        gstEnabled,
        gstRate,
        lineSubtotal,
        lineDiscount,
        taxableAmount: taxable,
        lineTax,
        lineTotal,
        availableQuantity: Number(stock.quantity),
      });
    }

    subtotal = money(subtotal);
    discountTotal = money(discountTotal);
    gstTotal = money(gstTotal);

    const taxableAmount = money(subtotal - discountTotal);
    const total = money(taxableAmount + gstTotal);
    const paidAmount = Number(body.paymentAmount ?? 0);

    if (!Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > total) {
      res.status(400).json({
        message: 'Amount received must be between zero and the invoice total.',
      });
      return;
    }

    const dueAmount = money(total - paidAmount);

    const customer = body.customer ?? {};
    const customerName = cleanText(customer.name);
    const customerMobile = cleanText(customer.mobile);

    if (dueAmount > 0 && (!customerName || !customerMobile)) {
      res.status(400).json({
        message: 'Customer name and mobile are required when payment is due.',
      });
      return;
    }

    if (customerName.length > 150 || customerMobile.length > 20) {
      res.status(400).json({ message: 'Customer details exceed the allowed length.' });
      return;
    }

    res.json({
      items,
      calculation: {
        subtotal,
        discountTotal,
        taxableAmount,
        gstTotal,
        total,
        paidAmount: money(paidAmount),
        dueAmount,
      },
    });
  } catch (error) {
    next(error);
  }
});


export default router;

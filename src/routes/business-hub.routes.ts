import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { BusinessHubTransaction, BUSINESS_TRANSACTION_TYPES, BUSINESS_TRANSACTION_PAYMENT_METHODS } from '../models/business-hub-transaction.model.js';

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

export default router;

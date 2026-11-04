
import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { startSession, Types } from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { BusinessHubStock } from '../models/business-hub-stock.model.js';
import { BusinessHubInvoice } from '../models/business-hub-invoice.model.js';
import { BusinessHubDueRecord } from '../models/business-hub-due-record.model.js';
import { BusinessHubInvoiceCounter } from '../models/business-hub-invoice-counter.model.js';

const router = Router();
router.use(requireAuth);

const PAYMENT_METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Other'] as const;
const cleanText = (value: unknown): string => String(value ?? '').trim();
const money = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

function getContext(
  req: Request,
  res: Response,
): { accountId: string; userId: string } | null {
  const accountId = cleanText(req.auth?.accountId);
  const userId = cleanText(req.auth?.userId);

  if (!accountId || !userId) {
    res.status(409).json({
      message: 'Account information is missing. Please sign in again.',
    });
    return null;
  }

  return { accountId, userId };
}

function escapeHtml(value: unknown): string {
  return cleanText(value).replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return replacements[character] ?? character;
  });
}

function publicInvoice(invoice: any) {
  return {
    id: String(invoice._id),
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    customer: invoice.customer,
    items: invoice.items,
    calculation: {
      ...invoice.calculation,
      roundOff: Number(invoice.calculation?.roundOff ?? 0),
    },
    paymentMethod: invoice.paymentMethod,
    notes: invoice.notes ?? '',
    dueRecordId: invoice.dueRecordId
      ? String(invoice.dueRecordId)
      : undefined,
  };
}

function calculateTotals(
  subtotalValue: number,
  discountValue: number,
  gstValue: number,
) {
  const subtotal = money(subtotalValue);
  const discountTotal = money(discountValue);
  const taxableAmount = money(Math.max(0, subtotal - discountTotal));
  const gstTotal = money(gstValue);

  // Preserve paise in invoice total.
  // Example: ₹2374.40 must remain ₹2374.40.
  const total = money(taxableAmount + gstTotal);
  const roundOff = 0;

  return {
    subtotal,
    discountTotal,
    taxableAmount,
    gstTotal,
    roundOff,
    total,
  };
}

function invoiceNumberPreferences(body: any) {
  const raw = body?.invoiceNumberSettings ?? {};

  const prefix =
    cleanText(raw.prefix || 'BTECH')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .slice(0, 20) || 'BTECH';

  const startNumber = Number(raw.startNumber ?? 1);
  const padding = Number(raw.padding ?? 5);

  return {
    prefix,
    startNumber:
      Number.isSafeInteger(startNumber) &&
      startNumber >= 1 &&
      startNumber <= 1_000_000_000_000
        ? startNumber
        : 1,
    padding:
      Number.isInteger(padding) && padding >= 1 && padding <= 12
        ? padding
        : 5,
  };
}

async function buildInvoiceLines(
  rawItems: any[],
  accountId: string,
  session?: any,
  deductStock = false,
) {
  const seen = new Set<string>();
  const items: any[] = [];

  let subtotal = 0;
  let discountTotal = 0;
  let gstTotal = 0;

  for (const raw of rawItems) {
    const stockItemId = cleanText(raw?.stockItemId);
    const quantity = Number(raw?.quantity);
    const unitPrice = Number(raw?.unitPrice);
    const discountPercent = Number(raw?.discountPercent ?? 0);

    if (!Types.ObjectId.isValid(stockItemId)) {
      throw Object.assign(new Error('A product ID is invalid.'), {
        status: 400,
      });
    }

    if (seen.has(stockItemId)) {
      throw Object.assign(
        new Error('Each product can appear only once.'),
        { status: 400 },
      );
    }

    seen.add(stockItemId);

    if (!Number.isInteger(quantity) || quantity < 1) {
      throw Object.assign(
        new Error('Quantity must be a positive whole number.'),
        { status: 400 },
      );
    }

    if (
      !Number.isFinite(unitPrice) ||
      unitPrice < 0 ||
      unitPrice > 100_000_000_000
    ) {
      throw Object.assign(new Error('Enter a valid unit price.'), {
        status: 400,
      });
    }

    if (
      !Number.isFinite(discountPercent) ||
      discountPercent < 0 ||
      discountPercent > 100
    ) {
      throw Object.assign(
        new Error('Discount must be between 0 and 100%.'),
        { status: 400 },
      );
    }

    const query = BusinessHubStock.findOne({
      _id: stockItemId,
      accountId,
    });

    if (session) {
      query.session(session);
    }

    const stock: any = await query.lean();

    if (!stock) {
      throw Object.assign(
        new Error('Selected product was not found in your stock.'),
        { status: 404 },
      );
    }

    if (deductStock) {
      const update = await BusinessHubStock.findOneAndUpdate(
        {
          _id: stockItemId,
          accountId,
          quantity: { $gte: quantity },
        },
        {
          $inc: { quantity: -quantity },
        },
        {
          returnDocument: 'after',
          session,
        },
      ).lean();

      if (!update) {
        throw Object.assign(
          new Error(
            `Insufficient stock for ${stock.name}. Refresh stock and try again.`,
          ),
          { status: 409 },
        );
      }
    } else if (quantity > Number(stock.quantity)) {
      throw Object.assign(
        new Error(
          `Insufficient stock for ${stock.name}. Available: ${stock.quantity} ${stock.unit}.`,
        ),
        { status: 409 },
      );
    }

    const lineSubtotal = money(quantity * unitPrice);
    const lineDiscount = money(
      (lineSubtotal * discountPercent) / 100,
    );
    const taxable = money(lineSubtotal - lineDiscount);

    const gstEnabled = Boolean(stock.gstEnabled);
    const gstRate = gstEnabled ? Number(stock.gstRate) || 0 : 0;
    const lineTax = gstEnabled
      ? money((taxable * gstRate) / 100)
      : 0;

    const lineTotal = money(taxable + lineTax);

    subtotal += lineSubtotal;
    discountTotal += lineDiscount;
    gstTotal += lineTax;

    items.push({
      stockItemId: new Types.ObjectId(stockItemId),
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
      lineTax,
      lineTotal,
      availableQuantity: Number(stock.quantity),
    });
  }

  return {
    items,
    calculation: calculateTotals(
      subtotal,
      discountTotal,
      gstTotal,
    ),
  };
}

function validatePaymentMethod(value: unknown): string | null {
  const raw = cleanText(value || 'Cash');

  const aliases: Record<string, string> = {
    cash: 'Cash',
    upi: 'UPI',
    card: 'Card',
    'bank-transfer': 'Bank Transfer',
    other: 'Other',
  };

  const paymentMethod = aliases[raw.toLowerCase()] || raw;

  return (PAYMENT_METHODS as readonly string[]).includes(paymentMethod)
    ? paymentMethod
    : null;
}

function validateCustomer(raw: any) {
  const customer = {
    name: cleanText(raw?.name),
    mobile: cleanText(raw?.mobile),
    email: cleanText(raw?.email),
    address: cleanText(raw?.address),
    gstin: cleanText(raw?.gstin).toUpperCase(),
  };

  if (
    customer.name.length > 150 ||
    customer.mobile.length > 20 ||
    customer.email.length > 254 ||
    customer.address.length > 1000 ||
    customer.gstin.length > 15
  ) {
    throw Object.assign(
      new Error('Customer details exceed the allowed length.'),
      { status: 400 },
    );
  }

  return customer;
}

// ---------------------------------------------------------
// PREVIEW INVOICE
// ---------------------------------------------------------

router.post(
  '/preview',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = getContext(req, res);
      if (!context) return;

      const rawItems = req.body?.items;

      if (
        !Array.isArray(rawItems) ||
        rawItems.length < 1 ||
        rawItems.length > 100
      ) {
        res.status(400).json({
          message: 'Add between 1 and 100 product lines.',
        });
        return;
      }

      const paymentMethod = validatePaymentMethod(
        req.body?.paymentMethod,
      );

      if (!paymentMethod) {
        res.status(400).json({
          message: 'Select a valid payment method.',
        });
        return;
      }

      const { items, calculation: base } =
        await buildInvoiceLines(rawItems, context.accountId);

      const paidAmount = Number(req.body?.paymentAmount ?? 0);
      const normalizedPaidAmount = money(paidAmount);

      if (
        !Number.isFinite(paidAmount) ||
        paidAmount < 0 ||
        normalizedPaidAmount > base.total
      ) {
        res.status(400).json({
          message:
            'Amount received must be between zero and the invoice total.',
        });
        return;
      }

      const dueAmount = money(base.total - normalizedPaidAmount);
      const customer = validateCustomer(req.body?.customer);

      if (dueAmount > 0 && (!customer.name || !customer.mobile)) {
        res.status(400).json({
          message:
            'Customer name and mobile are required when payment is due.',
        });
        return;
      }

      res.json({
        items,
        calculation: {
          ...base,
          paidAmount: normalizedPaidAmount,
          dueAmount,
        },
      });
    } catch (error: any) {
      if (error?.status) {
        res.status(error.status).json({ message: error.message });
        return;
      }

      next(error);
    }
  },
);

// ---------------------------------------------------------
// FINALIZE INVOICE
// ---------------------------------------------------------

router.post(
  '/finalize',
  async (req: Request, res: Response, next: NextFunction) => {
    const context = getContext(req, res);
    if (!context) return;

    const idempotencyKey = cleanText(req.body?.idempotencyKey);

    if (!idempotencyKey || idempotencyKey.length > 150) {
      res.status(400).json({
        message: 'A valid idempotency key is required.',
      });
      return;
    }

    try {
      const existing = await BusinessHubInvoice.findOne({
        accountId: context.accountId,
        idempotencyKey,
      }).lean();

      if (existing) {
        res.json({
          ...publicInvoice(existing),
          reused: true,
        });
        return;
      }

      const body = req.body ?? {};
      const rawItems = body.items;

      if (
        !Array.isArray(rawItems) ||
        rawItems.length < 1 ||
        rawItems.length > 100
      ) {
        res.status(400).json({
          message: 'Add between 1 and 100 product lines.',
        });
        return;
      }

      const paymentMethod = validatePaymentMethod(body.paymentMethod);

      if (!paymentMethod) {
        res.status(400).json({
          message: 'Select a valid payment method.',
        });
        return;
      }

      const customer = validateCustomer(body.customer);
      const notes = cleanText(body.notes);

      if (notes.length > 2000) {
        res.status(400).json({
          message: 'Invoice notes must be 2,000 characters or fewer.',
        });
        return;
      }

      const preferences = invoiceNumberPreferences(body);
      const session = await startSession();

      let savedInvoice: any = null;

      try {
        await session.withTransaction(async () => {
          const { items, calculation: base } =
            await buildInvoiceLines(
              rawItems,
              context.accountId,
              session,
              true,
            );

          const paidAmount = Number(body.paymentAmount ?? 0);
          const normalizedPaidAmount = money(paidAmount);

          if (
            !Number.isFinite(paidAmount) ||
            paidAmount < 0 ||
            normalizedPaidAmount > base.total
          ) {
            throw Object.assign(
              new Error(
                'Amount received must be between zero and the invoice total.',
              ),
              { status: 400 },
            );
          }

          const dueAmount = money(
            base.total - normalizedPaidAmount,
          );

          if (dueAmount > 0 && (!customer.name || !customer.mobile)) {
            throw Object.assign(
              new Error(
                'Customer name and mobile are required when payment is due.',
              ),
              { status: 400 },
            );
          }

          const counter: any =
            await BusinessHubInvoiceCounter.findOneAndUpdate(
              {
                accountId: context.accountId,
                year: 'ALL',
              },
              [
                {
                  $set: {
                    accountId: context.accountId,
                    year: 'ALL',
                    sequence: {
                      $add: [
                        {
                          $ifNull: [
                            '$sequence',
                            preferences.startNumber - 1,
                          ],
                        },
                        1,
                      ],
                    },
                    prefix: preferences.prefix,
                    padding: preferences.padding,
                  },
                },
              ] as any,
              {
                upsert: true,
                returnDocument: 'after',
                updatePipeline: true,
                session,
              } as any,
            ).lean();

          const invoiceNumber =
            `${preferences.prefix}${String(counter.sequence).padStart(
              preferences.padding,
              '0',
            )}`;

          const calculation = {
            ...base,
            paidAmount: normalizedPaidAmount,
            dueAmount,
          };

          const [invoice] = await BusinessHubInvoice.create(
            [
              {
                accountId: context.accountId,
                userId: context.userId,
                invoiceNumber,
                idempotencyKey,
                status: 'finalized',
                invoiceDate: new Date(),
                customer,
                items: items.map(
                  ({ availableQuantity: _availableQuantity, ...item }) =>
                    item,
                ),
                calculation,
                paymentMethod,
                notes,
              },
            ],
            { session },
          );

          let dueRecordId: Types.ObjectId | null = null;

          if (dueAmount > 0) {
            const initialPayments =
              normalizedPaidAmount > 0
                ? [
                    {
                      amount: normalizedPaidAmount,
                      paymentMethod,
                      paidAt: new Date(),
                      note: 'Initial payment at invoice finalization',
                    },
                  ]
                : [];

            const [dueRecord] =
              await BusinessHubDueRecord.create(
                [
                  {
                    accountId: context.accountId,
                    userId: context.userId,
                    invoiceId: invoice._id,
                    invoiceNumber,
                    customer: {
                      name: customer.name,
                      mobile: customer.mobile,
                      email: customer.email,
                      address: customer.address,
                    },
                    invoiceTotal: base.total,
                    amountPaid: normalizedPaidAmount,
                    balanceDue: dueAmount,
                    status:
                      normalizedPaidAmount > 0
                        ? 'partially-paid'
                        : 'due',
                    payments: initialPayments,
                    settledAt: null,
                  },
                ],
                { session },
              );

            dueRecordId = dueRecord._id;
            invoice.dueRecordId = dueRecordId;

            await invoice.save({ session });
          }

          savedInvoice = {
            ...publicInvoice(invoice.toObject()),
            dueRecordId: dueRecordId
              ? String(dueRecordId)
              : undefined,
          };
        });
      } finally {
        await session.endSession();
      }

      if (!savedInvoice) {
        res.status(500).json({
          message: 'Invoice could not be finalized.',
        });
        return;
      }

      res.status(201).json(savedInvoice);
    } catch (error: any) {
      if (error?.code === 11000) {
        const existing = await BusinessHubInvoice.findOne({
          accountId: context.accountId,
          idempotencyKey,
        }).lean();

        if (existing) {
          res.json({
            ...publicInvoice(existing),
            reused: true,
          });
          return;
        }
      }

      if (error?.status) {
        res.status(error.status).json({ message: error.message });
        return;
      }

      next(error);
    }
  },
);

// ---------------------------------------------------------
// GET INVOICES
// ---------------------------------------------------------

router.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = getContext(req, res);
      if (!context) return;

      const page = Math.max(
        1,
        Math.floor(Number(req.query.page) || 1),
      );

      const limit = Math.min(
        100,
        Math.max(1, Math.floor(Number(req.query.limit) || 20)),
      );

      const filter = { accountId: context.accountId };

      const [items, total] = await Promise.all([
        BusinessHubInvoice.find(filter)
          .sort({ invoiceDate: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        BusinessHubInvoice.countDocuments(filter),
      ]);

      res.json({
        items: items.map(publicInvoice),
        total,
        page,
        limit,
      });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------
// GET DUE RECORDS
// ---------------------------------------------------------

router.get(
  '/due-records',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = getContext(req, res);
      if (!context) return;

      const status = cleanText(req.query.status);

      const filter: Record<string, unknown> = {
        accountId: context.accountId,
      };

      if (['due', 'partially-paid', 'paid'].includes(status)) {
        filter.status = status;
      }

      const records = await BusinessHubDueRecord.find(filter)
        .sort({ createdAt: -1 })
        .limit(500)
        .lean();

      res.json({
        items: records.map((record: any) => ({
          ...record,
          id: String(record._id),
          invoiceId: String(record.invoiceId),
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------
// ADD PAYMENT TO DUE RECORD
// ---------------------------------------------------------

router.post(
  '/due-records/:id/payments',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = getContext(req, res);
      if (!context) return;

      const id = req.params.id;

      if (typeof id !== 'string' || !Types.ObjectId.isValid(id)) {
        res.status(400).json({
          message: 'Invalid due record ID.',
        });
        return;
      }

      const amount = Number(req.body?.amount);
      const paymentMethod = validatePaymentMethod(
        req.body?.paymentMethod,
      );
      const note = cleanText(req.body?.note);
      const idempotencyKey = cleanText(req.body?.idempotencyKey);

      if (idempotencyKey.length > 150) {
        res.status(400).json({
          message: 'Payment request key is invalid.',
        });
        return;
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        res.status(400).json({
          message: 'Payment amount must be greater than zero.',
        });
        return;
      }

      if (!paymentMethod) {
        res.status(400).json({
          message: 'Select a valid payment method.',
        });
        return;
      }

      if (note.length > 500) {
        res.status(400).json({
          message: 'Payment note must be 500 characters or fewer.',
        });
        return;
      }

      const session = await startSession();
      let updated: any = null;

      try {
        await session.withTransaction(async () => {
          const record: any =
            await BusinessHubDueRecord.findOne({
              _id: id,
              accountId: context.accountId,
            }).session(session);

          if (!record) {
            throw Object.assign(
              new Error('Due record not found.'),
              { status: 404 },
            );
          }

          // A retried request with the same key must not add the payment twice.
          if (idempotencyKey && record.payments.some(
            (payment: any) => payment.idempotencyKey === idempotencyKey,
          )) {
            updated = record.toObject();
            return;
          }

          if (
            record.status === 'paid' ||
            record.balanceDue <= 0
          ) {
            throw Object.assign(
              new Error('This due has already been settled.'),
              { status: 409 },
            );
          }

          if (money(amount) > money(record.balanceDue)) {
            throw Object.assign(
              new Error(
                'Payment cannot be greater than the outstanding balance.',
              ),
              { status: 400 },
            );
          }

          const invoice: any = await BusinessHubInvoice.findOne({
            _id: record.invoiceId,
            accountId: context.accountId,
          }).session(session);

          if (!invoice) {
            throw Object.assign(
              new Error('The invoice linked to this due record was not found.'),
              { status: 409 },
            );
          }

          record.amountPaid = money(
            record.amountPaid + amount,
          );

          record.balanceDue = money(
            Math.max(0, record.invoiceTotal - record.amountPaid),
          );

          record.payments.push({
            amount: money(amount),
            paymentMethod,
            paidAt: new Date(),
            note,
            idempotencyKey,
          } as any);

          record.status =
            record.balanceDue === 0
              ? 'paid'
              : 'partially-paid';

          record.settledAt =
            record.balanceDue === 0
              ? new Date()
              : null;

          // Keep the invoice totals in sync with the payment ledger.
          invoice.calculation.paidAmount = record.amountPaid;
          invoice.calculation.dueAmount = record.balanceDue;

          await record.save({ session });
          await invoice.save({ session });
          updated = record.toObject();
        });
      } finally {
        await session.endSession();
      }

      res.json({
        ...updated,
        id: String(updated._id),
        invoiceId: String(updated.invoiceId),
      });
    } catch (error: any) {
      if (error?.status) {
        res.status(error.status).json({
          message: error.message,
        });
        return;
      }

      next(error);
    }
  },
);

// ---------------------------------------------------------
// GET SINGLE INVOICE
// ---------------------------------------------------------

router.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = getContext(req, res);
      if (!context) return;

      const id = req.params.id;

      if (typeof id !== 'string' || !Types.ObjectId.isValid(id)) {
        res.status(400).json({
          message: 'Invalid invoice ID.',
        });
        return;
      }

      const invoice = await BusinessHubInvoice.findOne({
        _id: id,
        accountId: context.accountId,
      }).lean();

      if (!invoice) {
        res.status(404).json({
          message: 'Invoice not found.',
        });
        return;
      }

      res.json(publicInvoice(invoice));
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------
// PRINT INVOICE
// ---------------------------------------------------------

router.get(
  '/:id/print',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = getContext(req, res);
      if (!context) return;

      const id = req.params.id;

      if (typeof id !== 'string' || !Types.ObjectId.isValid(id)) {
        res.status(400).send('Invalid invoice ID.');
        return;
      }

      const invoice: any = await BusinessHubInvoice.findOne({
        _id: id,
        accountId: context.accountId,
      }).lean();

      if (!invoice) {
        res.status(404).send('Invoice not found.');
        return;
      }

      const logoUrl =
        'https://pub-17cca15e23224082ba93eaef907a4ea5.r2.dev/accounts/BT00002/media/1790446488384-9e170bff-cb93-45a1-bd7a-1c8186cc5028.webp';

      const rows = (invoice.items ?? [])
        .map(
          (item: any) => `
          <tr>
            <td class="product-cell">
              <strong>${escapeHtml(item.name)}</strong>
              ${
                item.description
                  ? `<small>${escapeHtml(item.description)}</small>`
                  : ''
              }
              ${
                item.sku
                  ? `<small class="sku">${escapeHtml(item.sku)}</small>`
                  : ''
              }
            </td>
            <td>${Number(item.quantity)} ${escapeHtml(item.unit)}</td>
            <td>₹${money(item.unitPrice).toFixed(2)}</td>
            <td>₹${money(item.lineDiscount).toFixed(2)}</td>
            <td>₹${money(item.lineTax).toFixed(2)}</td>
            <td class="amount">₹${money(item.lineTotal).toFixed(2)}</td>
          </tr>
        `,
        )
        .join('');

      const calc = invoice.calculation;
      const invoiceDate = new Date(
        invoice.invoiceDate,
      ).toLocaleDateString('en-IN');

      const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(invoice.invoiceNumber)}</title>

<style>
  * {
    box-sizing: border-box;
  }

  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #101828;
    background: #fff;
    margin: 0;
    padding: 28px;
  }

  .sheet {
    max-width: 1050px;
    margin: 0 auto;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 16px;
  }

  .actions button {
    border: 0;
    border-radius: 8px;
    background: #123d78;
    color: #fff;
    padding: 10px 18px;
    font-weight: 700;
    cursor: pointer;
  }

  .invoice-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding: 4px 0 20px;
    border-bottom: 4px solid #164b8b;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 22px;
    min-width: 0;
    flex: 1;
  }

  .brand-logo {
    width: 124px;
    height: 124px;
    flex: 0 0 124px;
    display: block;
    object-fit: cover;
    border-radius: 50%;
    border: 2px solid #164b8b;
    padding: 4px;
    background: #fff;
    overflow: hidden;
  }

  .brand-copy {
    min-width: 0;
  }

  .business-name {
    font-size: clamp(48px, 6vw, 76px);
    line-height: 1.02;
    font-weight: 900;
    letter-spacing: .2px;
    color: #102d60;
    margin: 0;
    text-transform: uppercase;
  }

  .tagline {
    font-size: 19px;
    font-weight: 700;
    color: #173e79;
    margin: 8px 0 0;
  }

  .invoice-meta {
    flex: 0 0 250px;
    border-left: 3px solid #164b8b;
    padding-left: 24px;
  }

  .invoice-title {
    font-size: 36px;
    font-weight: 800;
    color: #102d60;
    margin: 0 0 8px;
  }

  .invoice-meta p {
    font-size: 15px;
    margin: 5px 0;
    color: #172033;
  }

  .invoice-meta strong {
    font-size: 17px;
  }

  .section-title {
    display: inline-block;
    background: #123f7c;
    color: #fff;
    border-radius: 6px;
    padding: 8px 15px;
    font-size: 17px;
    margin: 20px 0 10px;
  }

  .customer {
    font-size: 15px;
    line-height: 1.65;
    margin: 0 0 14px;
  }

  .customer-name {
    font-size: 22px;
    font-weight: 800;
    color: #101828;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 18px;
    font-size: 14px;
  }

  thead th {
    background: #123f7c;
    color: #fff;
    padding: 13px 11px;
    text-align: center;
    font-size: 15px;
    border: 1px solid #fff;
  }

  thead th:first-child {
    text-align: left;
  }

  tbody td {
    padding: 12px 11px;
    border: 1px solid #b8c8dc;
    text-align: center;
    vertical-align: middle;
  }

  tbody tr:nth-child(even) {
    background: #f7faff;
  }

  .product-cell {
    text-align: left;
    min-width: 180px;
  }

  .product-cell strong {
    display: block;
    font-size: 15px;
  }

  .product-cell small {
    display: block;
    font-size: 12px;
    font-style: italic;
    margin-top: 3px;
    color: #475467;
  }

  .product-cell .sku {
    font-style: normal;
    font-size: 10px;
    color: #667085;
  }

  .amount {
    font-weight: 700;
  }

  .bottom-area {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 30px;
    margin-top: 18px;
  }

  .notes-area {
    flex: 1;
    min-width: 180px;
    padding-top: 34px;
  }

  .notes-text {
    font-size: 15px;
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .totals {
    width: 390px;
    max-width: 48%;
    border: 1px solid #8eadd5;
    border-radius: 5px;
    overflow: hidden;
    background: #f5f8ff;
  }

  .total-row {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 8px 12px;
    border-bottom: 1px solid #c2d3e8;
    font-size: 15px;
  }

  .total-row:last-child {
    border-bottom: 0;
  }

  .total-row strong {
    text-align: right;
  }

  .grand-total {
    background: #123f7c;
    color: #fff;
    font-size: 19px;
    font-weight: 800;
  }

  .signature {
    width: 260px;
    margin: 48px 0 0 8px;
    text-align: center;
    font-size: 14px;
  }

  .signature-line {
    border-top: 2px solid #172033;
    padding-top: 8px;
  }

  .footer {
    border-top: 3px solid #164b8b;
    text-align: center;
    color: #173e79;
    font-size: 13px;
    font-weight: 600;
    margin-top: 24px;
    padding-top: 12px;
  }

  @media (max-width: 900px) {
    .invoice-header {
      gap: 14px;
    }

    .brand {
      gap: 14px;
    }

    .brand-logo {
      width: 100px;
      height: 100px;
      flex-basis: 100px;
    }

    .business-name {
      font-size: 48px;
    }

    .invoice-meta {
      flex-basis: 210px;
      padding-left: 16px;
    }
  }

  @media (max-width: 700px) {
    body {
      padding: 14px;
    }

    .invoice-header {
      align-items: flex-start;
      flex-direction: column;
    }

    .brand {
      gap: 12px;
      width: 100%;
    }

    .brand-logo {
      width: 88px;
      height: 88px;
      flex-basis: 88px;
    }

    .business-name {
      font-size: 36px;
      font-weight: 900;
    }

    .tagline {
      font-size: 13px;
    }

    .invoice-meta {
      border-left: 0;
      border-top: 2px solid #164b8b;
      padding: 12px 0 0;
      width: 100%;
      flex-basis: auto;
    }

    .invoice-title {
      font-size: 28px;
    }

    .bottom-area {
      flex-direction: column;
    }

    .totals {
      width: 100%;
      max-width: none;
    }

    .notes-area {
      padding-top: 0;
    }

    table {
      font-size: 11px;
    }

    thead th,
    tbody td {
      padding: 7px 4px;
    }

    .product-cell {
      min-width: 100px;
    }

    .signature {
      margin-top: 35px;
    }
  }

  @media print {
    body {
      padding: 0;
    }

    .actions {
      display: none;
    }

    .sheet {
      max-width: none;
    }

    .invoice-header,
    thead th,
    .grand-total,
    .section-title {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }

  @page {
    size: A4;
    margin: 12mm;
  }
</style>
</head>

<body>
<div class="sheet">

  <div class="actions">
    <button onclick="window.print()">Print / Save as PDF</button>
  </div>

  <header class="invoice-header">

    <div class="brand">

      <img
        class="brand-logo"
        src="${logoUrl}"
        alt="Brain Techno logo"
        loading="eager"
        decoding="sync"
        referrerpolicy="no-referrer"
      >

      <div class="brand-copy">
        <h1 class="business-name">BRAIN TECHNO</h1>
        <p class="tagline">Innovative Solutions. Better Tomorrow.</p>
      </div>

    </div>

    <div class="invoice-meta">
      <h2 class="invoice-title">INVOICE</h2>
      <p><strong>${escapeHtml(invoice.invoiceNumber)}</strong></p>
      <p>Date: ${escapeHtml(invoiceDate)}</p>
      <p>Payment: ${escapeHtml(invoice.paymentMethod)}</p>
    </div>

  </header>

  <section>
    <h3 class="section-title">Bill To</h3>

    <div class="customer">
      <div class="customer-name">
        ${escapeHtml(invoice.customer.name || 'Walk-in Customer')}
      </div>

      ${
        invoice.customer.mobile
          ? `<div>☎ ${escapeHtml(invoice.customer.mobile)}</div>`
          : ''
      }

      ${
        invoice.customer.email
          ? `<div>✉ ${escapeHtml(invoice.customer.email)}</div>`
          : ''
      }

      ${
        invoice.customer.address
          ? `<div>⌖ ${escapeHtml(invoice.customer.address)}</div>`
          : ''
      }

      ${
        invoice.customer.gstin
          ? `<div><strong>GSTIN:</strong> ${escapeHtml(invoice.customer.gstin)}</div>`
          : ''
      }
    </div>
  </section>

  <table>
    <thead>
      <tr>
        <th>Product</th>
        <th>Qty</th>
        <th>Price</th>
        <th>Discount</th>
        <th>GST</th>
        <th>Amount</th>
      </tr>
    </thead>

    <tbody>
      ${rows}
    </tbody>
  </table>

  <div class="bottom-area">

    <div class="notes-area">
      ${
        invoice.notes
          ? `<h3 class="section-title">Notes</h3>
             <div class="notes-text">${escapeHtml(invoice.notes)}</div>`
          : '<div class="notes-text">Thank you for your business!</div>'
      }
    </div>

    <div class="totals">

      <div class="total-row">
        <span>Subtotal</span>
        <strong>₹${money(calc.subtotal).toFixed(2)}</strong>
      </div>

      <div class="total-row">
        <span>Discount</span>
        <strong>− ₹${money(calc.discountTotal).toFixed(2)}</strong>
      </div>

      <div class="total-row">
        <span>Taxable Amount</span>
        <strong>₹${money(calc.taxableAmount).toFixed(2)}</strong>
      </div>

      <div class="total-row">
        <span>GST</span>
        <strong>₹${money(calc.gstTotal).toFixed(2)}</strong>
      </div>

      <div class="total-row">
        <span>Round Off</span>
        <strong>₹${money(calc.roundOff ?? 0).toFixed(2)}</strong>
      </div>

      <div class="total-row grand-total">
        <span>Total</span>
        <strong>₹${money(calc.total).toFixed(2)}</strong>
      </div>

      <div class="total-row">
        <span>Paid</span>
        <strong>₹${money(calc.paidAmount).toFixed(2)}</strong>
      </div>

      <div class="total-row">
        <span>Due</span>
        <strong>₹${money(calc.dueAmount).toFixed(2)}</strong>
      </div>

    </div>
  </div>

  <div class="signature">
    <div class="signature-line">Authorised Signature</div>
  </div>

  <footer class="footer">
    This is a computer generated invoice.
    &nbsp; | &nbsp;
    Produced by <strong>BRAIN TECHNO</strong>
  </footer>

</div>
</body>
</html>`;

      res.type('html').send(html);
    } catch (error) {
      next(error);
    }
  },
);

export default router;

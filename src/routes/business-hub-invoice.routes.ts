
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

const PAYMENT_METHODS = [
    'Cash',
    'UPI',
    'Card',
    'Bank Transfer',
    'Other',
] as const;

const cleanText = (value: unknown): string =>
    String(value ?? '').trim();

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

function indiaYear(): number {
    return Number(
        new Intl.DateTimeFormat('en', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
        }).format(new Date()),
    );
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
        calculation: invoice.calculation,
        paymentMethod: invoice.paymentMethod,
        notes: invoice.notes ?? '',
        dueRecordId: invoice.dueRecordId
            ? String(invoice.dueRecordId)
            : undefined,
    };
}

/**
 * POST /api/business-hub/invoices/preview
 *
 * Calculates invoice totals without saving an invoice
 * and without deducting stock.
 */
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
                    res.status(400).json({
                        message: 'A product ID is invalid.',
                    });
                    return;
                }

                if (seen.has(stockItemId)) {
                    res.status(400).json({
                        message: 'Each product can appear only once.',
                    });
                    return;
                }

                seen.add(stockItemId);

                if (!Number.isInteger(quantity) || quantity < 1) {
                    res.status(400).json({
                        message: 'Quantity must be a positive whole number.',
                    });
                    return;
                }

                if (
                    !Number.isFinite(unitPrice) ||
                    unitPrice < 0 ||
                    unitPrice > 100000000000
                ) {
                    res.status(400).json({
                        message: 'Enter a valid unit price.',
                    });
                    return;
                }

                if (
                    !Number.isFinite(discountPercent) ||
                    discountPercent < 0 ||
                    discountPercent > 100
                ) {
                    res.status(400).json({
                        message: 'Discount must be between 0 and 100%.',
                    });
                    return;
                }

                const stock = await BusinessHubStock.findOne({
                    _id: stockItemId,
                    accountId: context.accountId,
                }).lean();

                if (!stock) {
                    res.status(404).json({
                        message: 'Selected product was not found in your stock.',
                    });
                    return;
                }

                if (quantity > Number(stock.quantity)) {
                    res.status(409).json({
                        message: `Insufficient stock for ${stock.name}. Available: ${stock.quantity} ${stock.unit}.`,
                    });
                    return;
                }

                const lineSubtotal = money(quantity * unitPrice);
                const lineDiscount = money(
                    lineSubtotal * discountPercent / 100,
                );
                const taxable = money(lineSubtotal - lineDiscount);

                const gstEnabled = Boolean(stock.gstEnabled);
                const gstRate = gstEnabled
                    ? Number(stock.gstRate) || 0
                    : 0;

                const lineTax = gstEnabled
                    ? money(taxable * gstRate / 100)
                    : 0;

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
            const paidAmount = Number(req.body?.paymentAmount ?? 0);

            if (
                !Number.isFinite(paidAmount) ||
                paidAmount < 0 ||
                paidAmount > total
            ) {
                res.status(400).json({
                    message: 'Amount received must be between zero and the invoice total.',
                });
                return;
            }

            const dueAmount = money(total - paidAmount);
            const customer = req.body?.customer ?? {};

            if (
                dueAmount > 0 &&
                (!cleanText(customer.name) || !cleanText(customer.mobile))
            ) {
                res.status(400).json({
                    message: 'Customer name and mobile are required when payment is due.',
                });
                return;
            }

            const paymentMethod = cleanText(
                req.body?.paymentMethod || 'Cash',
            );

            if (
                !(PAYMENT_METHODS as readonly string[]).includes(paymentMethod)
            ) {
                res.status(400).json({
                    message: 'Select a valid payment method.',
                });
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
    },
);

/**
 * POST /api/business-hub/invoices/finalize
 *
 * Saves the invoice, deducts stock and creates a due record
 * when the invoice has an outstanding balance.
 *
 * All database writes run inside one MongoDB transaction.
 */
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

            const paymentMethod = cleanText(body.paymentMethod || 'Cash');

            if (
                !(PAYMENT_METHODS as readonly string[]).includes(paymentMethod)
            ) {
                res.status(400).json({
                    message: 'Select a valid payment method.',
                });
                return;
            }

            const customer = {
                name: cleanText(body.customer?.name),
                mobile: cleanText(body.customer?.mobile),
                email: cleanText(body.customer?.email),
                address: cleanText(body.customer?.address),
                gstin: cleanText(body.customer?.gstin).toUpperCase(),
            };

            if (
                customer.name.length > 150 ||
                customer.mobile.length > 20 ||
                customer.email.length > 254 ||
                customer.address.length > 1000 ||
                customer.gstin.length > 15
            ) {
                res.status(400).json({
                    message: 'Customer details exceed the allowed length.',
                });
                return;
            }

            const notes = cleanText(body.notes);

            if (notes.length > 2000) {
                res.status(400).json({
                    message: 'Invoice notes must be 2,000 characters or fewer.',
                });
                return;
            }

            const session = await startSession();
            let savedInvoice: any = null;

            try {
                await session.withTransaction(async () => {
                    // Keep this inside the callback because MongoDB can retry it.
                    const seen = new Set<string>();
                    const items: any[] = [];

                    let subtotal = 0;
                    let discountTotal = 0;
                    let gstTotal = 0;

                    for (const raw of rawItems) {
                        const stockItemId = cleanText(raw?.stockItemId);
                        const quantity = Number(raw?.quantity);
                        const unitPrice = Number(raw?.unitPrice);
                        const discountPercent = Number(
                            raw?.discountPercent ?? 0,
                        );

                        if (!Types.ObjectId.isValid(stockItemId)) {
                            throw Object.assign(
                                new Error('A product ID is invalid.'),
                                { status: 400 },
                            );
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
                            unitPrice > 100000000000
                        ) {
                            throw Object.assign(
                                new Error('Enter a valid unit price.'),
                                { status: 400 },
                            );
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

                        const stock = await BusinessHubStock.findOne({
                            _id: stockItemId,
                            accountId: context.accountId,
                        })
                            .session(session)
                            .lean();

                        if (!stock) {
                            throw Object.assign(
                                new Error('Selected product was not found in your stock.'),
                                { status: 404 },
                            );
                        }

                        // Conditional update prevents stock becoming negative.
                        const updatedStock =
                            await BusinessHubStock.findOneAndUpdate(
                                {
                                    _id: stockItemId,
                                    accountId: context.accountId,
                                    quantity: { $gte: quantity },
                                },
                                {
                                    $inc: { quantity: -quantity },
                                },
                                {
                                    new: true,
                                    session,
                                },
                            ).lean();

                        if (!updatedStock) {
                            throw Object.assign(
                                new Error(
                                    `Insufficient stock for ${stock.name}. Refresh stock and try again.`,
                                ),
                                { status: 409 },
                            );
                        }

                        const lineSubtotal = money(quantity * unitPrice);
                        const lineDiscount = money(
                            lineSubtotal * discountPercent / 100,
                        );
                        const taxable = money(lineSubtotal - lineDiscount);

                        // GST configuration comes from the saved stock record.
                        const gstEnabled = Boolean(stock.gstEnabled);
                        const gstRate = gstEnabled
                            ? Number(stock.gstRate) || 0
                            : 0;

                        const lineTax = gstEnabled
                            ? money(taxable * gstRate / 100)
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
                        });
                    }

                    subtotal = money(subtotal);
                    discountTotal = money(discountTotal);
                    gstTotal = money(gstTotal);

                    const taxableAmount = money(subtotal - discountTotal);
                    const total = money(taxableAmount + gstTotal);
                    const paidAmount = Number(body.paymentAmount ?? 0);

                    if (
                        !Number.isFinite(paidAmount) ||
                        paidAmount < 0 ||
                        paidAmount > total
                    ) {
                        throw Object.assign(
                            new Error(
                                'Amount received must be between zero and the invoice total.',
                            ),
                            { status: 400 },
                        );
                    }

                    const dueAmount = money(total - paidAmount);

                    if (
                        dueAmount > 0 &&
                        (!customer.name || !customer.mobile)
                    ) {
                        throw Object.assign(
                            new Error(
                                'Customer name and mobile are required when payment is due.',
                            ),
                            { status: 400 },
                        );
                    }

                    const year = indiaYear();

                    const counter =
                        await BusinessHubInvoiceCounter.findOneAndUpdate(
                            {
                                accountId: context.accountId,
                                year,
                            },
                            {
                                $inc: { sequence: 1 },
                                $setOnInsert: {
                                    accountId: context.accountId,
                                    year,
                                },
                            },
                            {
                                upsert: true,
                                new: true,
                                session,
                                setDefaultsOnInsert: true,
                            },
                        );

                    const invoiceNumber =
                        `BT-${year}-${String(counter.sequence).padStart(5, '0')}`;

                    const calculation = {
                        subtotal,
                        discountTotal,
                        taxableAmount,
                        gstTotal,
                        total,
                        paidAmount: money(paidAmount),
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
                                items,
                                calculation,
                                paymentMethod,
                                notes,
                            },
                        ],
                        { session },
                    );

                    let dueRecordId: Types.ObjectId | null = null;

                    // Fully paid invoices do not create due records.
                    if (dueAmount > 0) {
                        const initialPayments =
                            paidAmount > 0
                                ? [
                                    {
                                        amount: money(paidAmount),
                                        paymentMethod,
                                        paidAt: new Date(),
                                        note: 'Initial payment at invoice finalization',
                                    },
                                ]
                                : [];

                        const [dueRecord] = await BusinessHubDueRecord.create(
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
                                    invoiceTotal: total,
                                    amountPaid: money(paidAmount),
                                    balanceDue: dueAmount,
                                    status:
                                        paidAmount > 0 ? 'partially-paid' : 'due',
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
            // A retry with the same key should return the saved invoice.
            if (error?.code === 11000) {
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
                } catch {
                    // Fall through to normal error handling.
                }
            }

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

/**
 * GET /api/business-hub/invoices
 */
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

/**
 * GET /api/business-hub/invoices/due-records
 */
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

            if (
                ['due', 'partially-paid', 'paid'].includes(status)
            ) {
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

/**
 * POST /api/business-hub/invoices/due-records/:id/payments
 */
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
            const paymentMethod = cleanText(
                req.body?.paymentMethod || 'Cash',
            );
            const note = cleanText(req.body?.note);

            if (!Number.isFinite(amount) || amount <= 0) {
                res.status(400).json({
                    message: 'Payment amount must be greater than zero.',
                });
                return;
            }

            if (
                !(PAYMENT_METHODS as readonly string[]).includes(paymentMethod)
            ) {
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
                    const record = await BusinessHubDueRecord.findOne({
                        _id: id,
                        accountId: context.accountId,
                    }).session(session);

                    if (!record) {
                        throw Object.assign(
                            new Error('Due record not found.'),
                            { status: 404 },
                        );
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

                    record.amountPaid = money(record.amountPaid + amount);
                    record.balanceDue = money(
                        record.invoiceTotal - record.amountPaid,
                    );

                    record.payments.push({
                        amount: money(amount),
                        paymentMethod,
                        paidAt: new Date(),
                        note,
                    } as any);

                    record.status =
                        record.balanceDue === 0
                            ? 'paid'
                            : 'partially-paid';

                    record.settledAt =
                        record.balanceDue === 0 ? new Date() : null;

                    await record.save({ session });
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

/**
 * GET /api/business-hub/invoices/:id
 */
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

/**
 * GET /api/business-hub/invoices/:id/print
 *
 * Returns print-ready HTML. The browser's Print dialog can save it as PDF.
 */
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

            const invoice = await BusinessHubInvoice.findOne({
                _id: id,
                accountId: context.accountId,
            }).lean() as any;

            if (!invoice) {
                res.status(404).send('Invoice not found.');
                return;
            }

            const rows = invoice.items
                .map(
                    (item: any) => `
            <tr>
              <td>
                ${escapeHtml(item.name)}
                <br><small>${escapeHtml(item.sku || '')}</small>
              </td>
              <td>${item.quantity} ${escapeHtml(item.unit)}</td>
              <td>₹${money(item.unitPrice).toFixed(2)}</td>
              <td>₹${money(item.lineDiscount).toFixed(2)}</td>
              <td>₹${money(item.lineTax).toFixed(2)}</td>
              <td>₹${money(item.lineTotal).toFixed(2)}</td>
            </tr>
          `,
                )
                .join('');

            const calculation = invoice.calculation;

            const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(invoice.invoiceNumber)}</title>
<style>
body{font:14px Arial,sans-serif;color:#222;margin:0;padding:32px}
.sheet{max-width:850px;margin:auto}
.top{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #222;padding-bottom:18px}
.muted{color:#666}
table{width:100%;border-collapse:collapse;margin-top:28px}
th,td{padding:10px 8px;border-bottom:1px solid #ddd;text-align:left}
th{background:#f4f4f4}
.totals{margin:24px 0 0 auto;max-width:330px}
.row{display:flex;justify-content:space-between;padding:6px 0}
.grand{font-size:18px;font-weight:bold;border-top:2px solid #222;margin-top:6px;padding-top:12px}
@media print{body{padding:0}.actions{display:none}.sheet{max-width:none}}
@page{size:A4;margin:14mm}
</style>
</head>
<body>
<div class="sheet">
  <div class="actions">
    <button onclick="window.print()">Print / Save as PDF</button>
  </div>
  <div class="top">
    <div>
      <h1>INVOICE</h1>
      <strong>BRAIN TECHNO</strong>
      <p class="muted">Business details can be configured in Business Profile.</p>
    </div>
    <div>
      <strong>${escapeHtml(invoice.invoiceNumber)}</strong>
      <p>Date: ${new Date(invoice.invoiceDate).toLocaleDateString('en-IN')}</p>
      <p>Payment: ${escapeHtml(invoice.paymentMethod)}</p>
    </div>
  </div>
  <h3>Bill To</h3>
  <p>
    <strong>${escapeHtml(invoice.customer.name || 'Walk-in Customer')}</strong><br>
    ${escapeHtml(invoice.customer.mobile)}<br>
    ${escapeHtml(invoice.customer.email)}<br>
    ${escapeHtml(invoice.customer.address)}<br>
    ${invoice.customer.gstin ? 'GSTIN: ' + escapeHtml(invoice.customer.gstin) : ''}
  </p>
  <table>
    <thead>
      <tr><th>Product</th><th>Qty</th><th>Price</th><th>Discount</th><th>GST</th><th>Amount</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div class="row"><span>Subtotal</span><strong>₹${money(calculation.subtotal).toFixed(2)}</strong></div>
    <div class="row"><span>Discount</span><strong>− ₹${money(calculation.discountTotal).toFixed(2)}</strong></div>
    <div class="row"><span>Taxable amount</span><strong>₹${money(calculation.taxableAmount).toFixed(2)}</strong></div>
    <div class="row"><span>GST</span><strong>₹${money(calculation.gstTotal).toFixed(2)}</strong></div>
    <div class="row grand"><span>Total</span><strong>₹${money(calculation.total).toFixed(2)}</strong></div>
    <div class="row"><span>Paid</span><strong>₹${money(calculation.paidAmount).toFixed(2)}</strong></div>
    <div class="row"><span>Due</span><strong>₹${money(calculation.dueAmount).toFixed(2)}</strong></div>
  </div>
  ${invoice.notes ? `<p><strong>Notes:</strong> ${escapeHtml(invoice.notes)}</p>` : ''}
  <p style="margin-top:48px;text-align:right">Authorised Signature __________________</p>
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

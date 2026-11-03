import { BusinessHubDueRecord } from "../../models/business-hub-due-record.model";
import { BusinessHubInvoice } from "../../models/business-hub-invoice.model";
import { Customer } from "../../models/customer.model";
import { Message } from "../../models/message.model";


const RETENTION_DAYS = 30;

/**
 * Permanently removes a due invoice 30 days after it is fully paid.
 * A customer is removed only when no other invoice, due record, or message
 * still references that customer.
 */
export async function cleanupPaidInvoices(): Promise<void> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const expiredRecords = await BusinessHubDueRecord.find({
    status: 'paid',
    settledAt: { $ne: null, $lte: cutoff },
  })
    .select('_id accountId invoiceId customerId settledAt')
    .lean();

  for (const record of expiredRecords as any[]) {
    if (record.customerId) {
      // Mark the contact first. If a later delete fails, the scheduled sweep
      // can retry customer cleanup on the next run.
      await Customer.updateOne(
        { _id: record.customerId, accountId: record.accountId },
        { $set: { cleanupEligibleAt: new Date() } },
      );
    }

    await BusinessHubInvoice.deleteOne({
      _id: record.invoiceId,
      accountId: record.accountId,
    });

    await BusinessHubDueRecord.deleteOne({
      _id: record._id,
      accountId: record.accountId,
      status: 'paid',
      settledAt: { $lte: cutoff },
    });
  }

  const cleanupCandidates = await Customer.find({
    cleanupEligibleAt: { $ne: null, $lte: new Date() },
  })
    .select('_id accountId')
    .limit(500)
    .lean();

  for (const customer of cleanupCandidates as any[]) {
    const [invoiceExists, dueExists, messageExists] = await Promise.all([
      BusinessHubInvoice.exists({ accountId: customer.accountId, customerId: customer._id }),
      BusinessHubDueRecord.exists({ accountId: customer.accountId, customerId: customer._id }),
      Message.exists({ accountId: customer.accountId, customerId: customer._id }),
    ]);

    if (!invoiceExists && !dueExists && !messageExists) {
      await Customer.deleteOne({ _id: customer._id, accountId: customer.accountId });
    }
  }

  if (expiredRecords.length) {
    console.log(`[Invoice cleanup] Removed ${expiredRecords.length} paid due record(s) older than 30 days.`);
  }
}

import { Customer } from '../models/customer.model.js';

export type BroadcastRecipientChannel = 'WhatsApp' | 'SMS' | 'Email';

const cleanText = (value: unknown): string => String(value ?? '').trim();

function contactFieldFilter(channel: BroadcastRecipientChannel): Record<string, unknown> {
  if (channel === 'Email') {
    return {
      $or: [
        { emailNormalized: { $exists: true, $ne: '' } },
        { email: { $exists: true, $ne: '' } }
      ]
    };
  }

  return {
    $or: [
      { mobileNormalized: { $exists: true, $ne: '' } },
      { mobile: { $exists: true, $ne: '' } }
    ]
  };
}

export function buildBroadcastCustomerFilter(
  accountId: string,
  businessId: string,
  audience: any,
  channels: BroadcastRecipientChannel[] = ['WhatsApp']
): Record<string, unknown> {
  const filter: Record<string, any> = {
    $or: [
      { accountId },
      ...(businessId ? [{ businessId }] : [])
    ]
  };

  const customerType = cleanText(audience?.customerType);
  if (customerType && customerType !== 'All') {
    filter.customerType = customerType;
  }

  const sources = Array.isArray(audience?.sources)
    ? audience.sources.map(cleanText).filter(Boolean)
    : [];

  if (sources.length) {
    filter.source = { $in: sources };
  }

  const lastContact = cleanText(audience?.lastContact).toLowerCase();
  if (lastContact && lastContact !== 'any') {
    const days = Number(lastContact);
    if (Number.isFinite(days) && days > 0) {
      const since = new Date();
      since.setDate(since.getDate() - days);
      filter.lastContactAt = { $gte: since };
    }
  }

  const city = cleanText(audience?.city);
  if (city && city !== 'All Cities') {
    filter.city = city;
  }

  const validChannels = channels.filter(
    channel => channel === 'WhatsApp' || channel === 'SMS' || channel === 'Email'
  );

  const contactFilters = Array.from(
    new Map(validChannels.map(channel => [channel, contactFieldFilter(channel)])).values()
  );

  if (contactFilters.length) {
    filter.$and = [
      ...(Array.isArray(filter.$and) ? filter.$and : []),
      { $or: contactFilters.flatMap(item => Array.isArray(item.$or) ? item.$or : []) }
    ];
  }

  return filter;
}

export function buildBroadcastChannelCustomerFilter(
  baseFilter: Record<string, unknown>,
  channel: BroadcastRecipientChannel
): Record<string, unknown> {
  return {
    ...baseFilter,
    $and: [
      ...((baseFilter as any).$and ?? []),
      contactFieldFilter(channel)
    ]
  };
}

export async function getBroadcastAudienceStats(
  accountId: string,
  businessId: string,
  audience: any,
  channels: BroadcastRecipientChannel[]
): Promise<{
  matchedCount: number;
  recipientCount: number;
  excludedCount: number;
  byChannel: Record<string, number>;
}> {
  const baseFilter = buildBroadcastCustomerFilter(accountId, businessId, audience, []);
  const matchedCount = await Customer.countDocuments(baseFilter);

  const uniqueChannels = Array.from(new Set(channels));
  const counts = await Promise.all(
    uniqueChannels.map(async channel => [
      channel,
      await Customer.countDocuments(
        buildBroadcastChannelCustomerFilter(baseFilter, channel)
      )
    ] as const)
  );

  const byChannel = Object.fromEntries(counts);

  // A customer is a recipient when at least one selected channel has the
  // required contact field. The OR condition mirrors the future send-time
  // eligibility check and prevents invalid recipients from being included.
  const eligibleFilter = buildBroadcastCustomerFilter(
    accountId,
    businessId,
    audience,
    uniqueChannels
  );
  const recipientCount = uniqueChannels.length
    ? await Customer.countDocuments(eligibleFilter)
    : 0;

  return {
    matchedCount,
    recipientCount,
    excludedCount: Math.max(0, matchedCount - recipientCount),
    byChannel
  };
}

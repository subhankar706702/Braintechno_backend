
import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from 'express';

import { requireAuth } from '../middleware/auth.js';
import { BusinessHubSettings } from '../models/business-hub-settings.model.js';

const router = Router();

router.use(requireAuth);

const DEFAULT_INVOICE_SETTINGS = {
  template: 'classic',
  pageSize: 'a4',
  printColor: 'color',
  primaryColor: '#ff4d6d',
  businessName: '',
  logoDataUrl: '',
  gstin: '',
  address: '',
  phone: '',
  email: '',
  state: '',
  footer: '',
  invoicePrefix: 'BTECH',
  invoiceStartNumber: 1,
  invoiceNumberPadding: 5,
};

const TEMPLATES = [
  'classic',
  'minimal',
  'basic-blue',
  'mono',
  'corporate',
  'elegant',
  'creative',
  'sidebar',
  'luxury',
  'gradient',
  'executive',
  'signature',
  'modern-pro',
  'my-brand',
  'design-studio',
  'modern',
  'gst',
  'premium',
] as const;

const PAGE_SIZES = [
  'a4',
  'a5',
  'letter',
  'legal',
] as const;

const PRINT_COLORS = [
  'color',
  'bw',
] as const;

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function getAccountId(
  req: Request,
  res: Response,
): string | null {
  const accountId = cleanText(req.auth?.accountId);

  if (!accountId) {
    res.status(409).json({
      message:
        'Your account is missing an account ID. Please sign in again.',
    });

    return null;
  }

  return accountId;
}

async function getOrCreateSettings(accountId: string) {
  try {
    await BusinessHubSettings.updateOne(
      { accountId },
      {
        $setOnInsert: {
          accountId,
          invoiceSettings: DEFAULT_INVOICE_SETTINGS,
        },
      },
      {
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );
  } catch (error: any) {
    if (error?.code !== 11000) {
      throw error;
    }
  }

  const settings = await BusinessHubSettings
    .findOne({ accountId })
    .lean();

  if (!settings) {
    throw new Error('Could not load invoice settings.');
  }

  return settings;
}

function validImageReference(value: string): boolean {
  if (!value) {
    return true;
  }

  if (value.length > 6 * 1024 * 1024) {
    return false;
  }

  if (/^https:\/\/[^\s]+$/i.test(value)) {
    return true;
  }

  return /^data:image\/(png|jpeg|jpg|webp);base64,[a-z0-9+/=\s]+$/i.test(
    value,
  );
}

function validateAndNormalizeSettings(
  input: unknown,
  current: any,
): {
  value?: Record<string, unknown>;
  error?: string;
} {
  const body =
    input && typeof input === 'object' && !Array.isArray(input)
      ? input as Record<string, unknown>
      : {};

  const merged = {
    ...DEFAULT_INVOICE_SETTINGS,
    ...(current || {}),
    ...body,
  };

  const template = cleanText(merged.template);
  const pageSize = cleanText(merged.pageSize);
  const printColor = cleanText(merged.printColor);
  const primaryColor = cleanText(merged.primaryColor);

  if (!(TEMPLATES as readonly string[]).includes(template)) {
    return {
      error: 'Choose a valid invoice template.',
    };
  }

  if (!(PAGE_SIZES as readonly string[]).includes(pageSize)) {
    return {
      error: 'Choose a valid invoice page size.',
    };
  }

  if (!(PRINT_COLORS as readonly string[]).includes(printColor)) {
    return {
      error: 'Choose a valid print color.',
    };
  }

  if (!/^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
    return {
      error: 'Enter a valid invoice primary color.',
    };
  }

  const fields: Record<string, number> = {
    businessName: 150,
    gstin: 20,
    address: 1000,
    phone: 30,
    email: 254,
    state: 100,
    footer: 500,
  };

  const value: Record<string, unknown> = {
    template,
    pageSize,
    printColor,
    primaryColor,
  };

  for (const [field, maxLength] of Object.entries(fields)) {
    const text = cleanText(merged[field]);

    if (text.length > maxLength) {
      return {
        error: `${field} must be ${maxLength} characters or fewer.`,
      };
    }

    value[field] = text;
  }

  const email = String(value['email'] || '');

  if (
    email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return {
      error: 'Enter a valid business email address.',
    };
  }

  const logoDataUrl = cleanText(merged.logoDataUrl);

  if (!validImageReference(logoDataUrl)) {
    return {
      error: 'Logo must be a valid image or HTTPS image URL under 6 MB.',
    };
  }

  value['logoDataUrl'] = logoDataUrl;

  const invoicePrefix = cleanText(
    merged.invoicePrefix || DEFAULT_INVOICE_SETTINGS.invoicePrefix
  )
    .replace(/[^a-zA-Z0-9-]/g, '')
    .slice(0, 20);

  value['invoicePrefix'] =
    invoicePrefix || DEFAULT_INVOICE_SETTINGS.invoicePrefix;

  const invoiceStartNumber = Number(merged.invoiceStartNumber);
  const invoiceNumberPadding = Number(merged.invoiceNumberPadding);

  if (
    !Number.isSafeInteger(invoiceStartNumber) ||
    invoiceStartNumber < 1
  ) {
    return {
      error: 'Invoice starting number must be a positive whole number.',
    };
  }

  if (
    !Number.isInteger(invoiceNumberPadding) ||
    invoiceNumberPadding < 1 ||
    invoiceNumberPadding > 12
  ) {
    return {
      error: 'Invoice number padding must be between 1 and 12.',
    };
  }

  value['invoiceStartNumber'] = invoiceStartNumber;
  value['invoiceNumberPadding'] = invoiceNumberPadding;

  return { value };
}

/**
 * GET /api/business-hub/invoice-settings
 * Loads account-wise invoice settings.
 */
router.get(
  '/',
  async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const accountId = getAccountId(req, res);

      if (!accountId) {
        return;
      }

      const settings = await getOrCreateSettings(accountId);

      res.json({
        ...DEFAULT_INVOICE_SETTINGS,
        ...(settings.invoiceSettings || {}),
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * PATCH /api/business-hub/invoice-settings
 * Saves account-wise invoice settings.
 */
router.patch(
  '/',
  async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const accountId = getAccountId(req, res);

      if (!accountId) {
        return;
      }

      const current = await getOrCreateSettings(accountId);

      const normalized = validateAndNormalizeSettings(
        req.body,
        current.invoiceSettings,
      );

      if (normalized.error || !normalized.value) {
        res.status(400).json({
          message: normalized.error || 'Invalid invoice settings.',
        });

        return;
      }

      const saved = await BusinessHubSettings.findOneAndUpdate(
        { accountId },
        {
          $set: {
            invoiceSettings: normalized.value,
          },
        },
        {
          new: true,
          runValidators: true,
        },
      ).lean();

      if (!saved) {
        res.status(500).json({
          message: 'Could not save invoice settings.',
        });

        return;
      }

      res.json({
        success: true,
        message: 'Invoice settings saved successfully.',
        settings: {
          ...DEFAULT_INVOICE_SETTINGS,
          ...(saved.invoiceSettings || {}),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;

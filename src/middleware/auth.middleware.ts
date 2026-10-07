import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';

interface TokenPayload {
  sub: string;
  businessId?: string;
  accountId?: string | number;
  role?: 'owner' | 'admin';
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authorization =
    req.headers.authorization;

  if (
    !authorization ||
    !authorization.startsWith('Bearer ')
  ) {
    res.status(401).json({
      message:
        'Authentication required.',
    });

    return;
  }

  const token =
    authorization.slice(7).trim();

  if (!token) {
    res.status(401).json({
      message:
        'Authentication required.',
    });

    return;
  }

  try {
    const decoded =
      jwt.verify(
        token,
        env.jwtSecret,
      );

    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      typeof decoded.sub !== 'string' ||
      !decoded.sub.trim()
    ) {
      res.status(401).json({
        message:
          'Session is invalid or expired.',
      });

      return;
    }

    const payload =
      decoded as TokenPayload;

    req.auth = {
      userId:
        payload.sub,

      businessId:
        payload.businessId,

      accountId:
        payload.accountId ?? '',

      role:
        payload.role === 'admin'
          ? 'admin'
          : 'owner',
    };

    next();
  } catch {
    res.status(401).json({
      message:
        'Session is invalid or expired.',
    });
  }
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (
    req.auth?.role !== 'admin'
  ) {
    res.status(403).json({
      message:
        'Admin access required.',
    });

    return;
  }

  next();
}
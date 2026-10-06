import crypto from 'node:crypto';

import { env } from '../../config/env.js';

function getKey(): Buffer {
  const raw = String(env.socialTokenEncryptionKey || '').trim();

  if (!raw) {
    throw new Error('SOCIAL_TOKEN_ENCRYPTION_KEY is not configured.');
  }

  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');

  if (key.length !== 32) {
    throw new Error(
      'SOCIAL_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.'
    );
  }

  return key;
}

export function encryptSocialToken(value: string): string {
  const plaintext = String(value || '');
  if (!plaintext) throw new Error('Cannot encrypt an empty social token.');

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptSocialToken(value: string): string {
  const [ivPart, tagPart, encryptedPart] = String(value || '').split('.');

  if (!ivPart || !tagPart || !encryptedPart) {
    throw new Error('Stored social token has an invalid format.');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getKey(),
    Buffer.from(ivPart, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

import crypto from 'node:crypto';
import { env } from '../../config/env';

const algorithm = 'aes-256-gcm';

const key = (): Buffer => {
  const value = String(env.socialTokenEncryptionKey || '').trim();

  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(
      'SOCIAL_TOKEN_ENCRYPTION_KEY must be a 64-character hexadecimal value.'
    );
  }

  return Buffer.from(value, 'hex');
};

export const encryptSocialToken = (plainText: string): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
};

export const decryptSocialToken = (payload: string): string => {
  const [ivValue, tagValue, encryptedValue] = String(payload).split('.');

  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error('Invalid encrypted social token.');
  }

  const decipher = crypto.createDecipheriv(
    algorithm,
    key(),
    Buffer.from(ivValue, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
};

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getSetting, upsertSetting } from './database-adapter.js';

function encryptionKey() {
  const source = process.env.SETTINGS_ENCRYPTION_KEY || process.env.AUTH_TOKEN_SECRET || process.env.ACCESS_PASSWORD || '';
  return createHash('sha256').update(source || 'local-dev-settings-key').digest();
}

function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

function decrypt(value) {
  if (!String(value || '').startsWith('enc:')) return value;
  const [, ivRaw, tagRaw, encryptedRaw] = String(value).split(':');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function maskSecret(value) {
  if (!value) return '';
  return '••••••••';
}

export async function getRuntimeSetting(key, fallback = '') {
  const setting = await getSetting(key);
  if (!setting?.setting_value) return process.env[key] || fallback;
  return setting.is_secret ? decrypt(setting.setting_value) : setting.setting_value;
}

export async function saveSetting({ key, value, isSecret, updatedBy }) {
  const storedValue = isSecret && value ? encrypt(value) : value;
  return upsertSetting({ key, value: storedValue, isSecret, updatedBy });
}

export function publicSetting(setting) {
  return {
    ...setting,
    setting_value: setting.is_secret ? maskSecret(setting.setting_value) : setting.setting_value,
  };
}

import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function fromBase64url(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function tokenSecret() {
  return process.env.AUTH_TOKEN_SECRET
    || process.env.SETTINGS_ENCRYPTION_KEY
    || process.env.ACCESS_PASSWORD
    || 'local-dev-token-secret';
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const derived = await scrypt(String(password), salt, 64);
  return `scrypt:${salt}:${derived.toString('base64url')}`;
}

export async function verifyPassword(password, passwordHash) {
  const [scheme, salt, hash] = String(passwordHash || '').split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = await scrypt(String(password), salt, 64);
  const expected = Buffer.from(hash, 'base64url');
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

export function signToken(user) {
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
  };
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', tokenSecret()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyToken(token) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) return null;
  const expected = createHmac('sha256', tokenSecret()).update(body).digest('base64url');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  const payload = JSON.parse(fromBase64url(body));
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

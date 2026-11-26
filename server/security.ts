import crypto from 'node:crypto';
import path from 'node:path';
import type { UserRole } from '../shared/domain.ts';

const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

function getJwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  return configured && configured.length >= 16 ? configured : EPHEMERAL_SECRET;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, hexKey] = parts;
  if (!salt || !hexKey) return false;
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(hexKey, 'hex');
  if (derivedBuf.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(derivedBuf, storedBuf);
}

export interface AuthTokenPayload {
  sub: number;
  email: string;
  role: UserRole;
  fullName: string;
  iat: number;
  exp: number;
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): string {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf8');
}

export function signAuthToken(user: {
  id: number;
  email: string;
  role: UserRole;
  fullName: string;
}): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      iat: nowSec,
      exp: nowSec + 60 * 60 * 12,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = base64UrlEncode(
    crypto.createHmac('sha256', getJwtSecret()).update(signingInput).digest(),
  );
  return `${signingInput}.${signature}`;
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const segments = token.split('.');
  if (segments.length !== 3) return null;
  const [header, payload, signature] = segments;
  if (!header || !payload || !signature) return null;

  const signingInput = `${header}.${payload}`;
  const expectedSig = base64UrlEncode(
    crypto.createHmac('sha256', getJwtSecret()).update(signingInput).digest(),
  );
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSig);
  if (actualBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(actualBuf, expectedBuf)) return null;

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as AuthTokenPayload;
    const nowSec = Math.floor(Date.now() / 1000);
    if (!parsed.sub || !parsed.role || parsed.exp < nowSec) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function resolvePrivateStoragePath(baseDir: string, relativeFilename: string): string {
  const safeName = path.basename(relativeFilename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, safeName);
  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error('Invalid storage path boundary.');
  }
  return resolvedTarget;
}

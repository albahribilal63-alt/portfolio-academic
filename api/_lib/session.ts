import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { ServerConfig } from './config.ts';
import type { VercelRequest, VercelResponse } from './platform.ts';

export const SESSION_COOKIE_NAME = 'bivmor_admin_session';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface AdminSession {
  adminEmail: string;
  issuedAt: number;
  expiresAt: number;
}

function encryptionKey(secret: string): Uint8Array {
  return Uint8Array.from(createHash('sha256').update(secret, 'utf8').digest());
}

function cookieAttributes(config?: Pick<ServerConfig, 'secureCookies'>) {
  return [
    'Path=/api',
    'HttpOnly',
    'SameSite=Strict',
    ...(config?.secureCookies ? ['Secure'] : []),
  ].join('; ');
}

export function createSessionCookie(response: VercelResponse, config: ServerConfig, adminEmail: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const session: AdminSession = { adminEmail, issuedAt, expiresAt: issuedAt + SESSION_TTL_SECONDS };
  const iv = Uint8Array.from(randomBytes(12));
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(config.adminSessionSecret), iv);
  const ciphertext = `${cipher.update(JSON.stringify(session), 'utf8', 'base64url')}${cipher.final('base64url')}`;
  const tag = cipher.getAuthTag().toString('base64url');
  const token = [Buffer.from(iv).toString('base64url'), ciphertext, tag].join('.');

  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${token}; ${cookieAttributes(config)}; Max-Age=${SESSION_TTL_SECONDS}; Expires=${new Date(session.expiresAt * 1000).toUTCString()}`,
  );
}

export function clearSessionCookie(response: VercelResponse, config?: Pick<ServerConfig, 'secureCookies'>) {
  response.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; ${cookieAttributes(config)}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
  );
}

function getCookie(request: VercelRequest): string | undefined {
  const header = request.headers.cookie;
  const cookies = Array.isArray(header) ? header.join(';') : header ?? '';
  const item = cookies.split(';').map((value) => value.trim()).find((value) => value.startsWith(`${SESSION_COOKIE_NAME}=`));
  return item?.slice(SESSION_COOKIE_NAME.length + 1);
}

export function hasAdminSessionCookie(request: VercelRequest): boolean {
  return getCookie(request) !== undefined;
}

export function readAdminSession(request: VercelRequest, config: ServerConfig): AdminSession | null {
  const token = getCookie(request);
  if (!token || token.length > 4_096) return null;

  try {
    const [encodedIv, encodedCiphertext, encodedTag, extra] = token.split('.');
    if (!encodedIv || !encodedCiphertext || !encodedTag || extra !== undefined) return null;
    const iv = Uint8Array.from(Buffer.from(encodedIv, 'base64url'));
    const ciphertext = encodedCiphertext;
    const tag = Uint8Array.from(Buffer.from(encodedTag, 'base64url'));
    if (iv.byteLength !== 12 || tag.byteLength !== 16) return null;

    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(config.adminSessionSecret), iv);
    decipher.setAuthTag(tag);
    const plaintext = `${decipher.update(ciphertext, 'base64url', 'utf8')}${decipher.final('utf8')}`;
    const value: unknown = JSON.parse(plaintext);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

    const session = value as Record<string, unknown>;
    if (
      typeof session.adminEmail !== 'string'
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(session.adminEmail)
      || session.adminEmail.length > 254
      || typeof session.issuedAt !== 'number'
      || typeof session.expiresAt !== 'number'
      || session.expiresAt <= Math.floor(Date.now() / 1000)
      || session.expiresAt - session.issuedAt > SESSION_TTL_SECONDS
    ) return null;

    return {
      adminEmail: session.adminEmail,
      issuedAt: session.issuedAt,
      expiresAt: session.expiresAt,
    };
  } catch {
    return null;
  }
}
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.ts';
import { getGithubData, getGithubUser, verifyRepositoryWriteAccess } from './github.ts';
import type { ServerConfig } from './config.ts';

const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_DERIVED_BYTES = 64;
const PASSWORD_HASH_MAX_MEMORY = 64 * 1024 * 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function derivePassword(password: string, salt: Buffer) {
  return scryptSync(password, salt, PASSWORD_DERIVED_BYTES, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: PASSWORD_HASH_MAX_MEMORY,
  });
}

function parsePasswordHash(value: string) {
  const parts = value.split('$');
  if (
    parts.length !== 6
    || parts[0] !== 'scrypt'
    || parts[1] !== String(SCRYPT_COST)
    || parts[2] !== String(SCRYPT_BLOCK_SIZE)
    || parts[3] !== String(SCRYPT_PARALLELIZATION)
    || !/^[A-Za-z0-9_-]+$/.test(parts[4] ?? '')
    || !/^[A-Za-z0-9_-]+$/.test(parts[5] ?? '')
  ) return null;

  const salt = Buffer.from(parts[4]!, 'base64url');
  const digest = Buffer.from(parts[5]!, 'base64url');
  if (
    salt.length !== PASSWORD_SALT_BYTES
    || digest.length !== PASSWORD_DERIVED_BYTES
    || salt.toString('base64url') !== parts[4]
    || digest.toString('base64url') !== parts[5]
  ) return null;
  return { salt, digest };
}

export function createAdminPasswordHash(password: string) {
  if (password.length < 12 || password.length > 1_024) {
    throw new Error('Admin password must be between 12 and 1024 characters.');
  }
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const digest = derivePassword(password, salt);
  return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

function readConfiguredCredentials() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email) || !passwordHash || !parsePasswordHash(passwordHash)) {
    throw new ApiError(503, 'ADMIN_CREDENTIALS_NOT_CONFIGURED', 'Admin email/password credentials are not configured.');
  }
  return { email, passwordHash };
}

function safeEqual(left: string, right: string) {
  return timingSafeEqual(
    createHash('sha256').update(left, 'utf8').digest(),
    createHash('sha256').update(right, 'utf8').digest(),
  );
}

export function authenticateAdminCredentials(email: string, password: string) {
  const configured = readConfiguredCredentials();
  if (email.length > 254 || password.length > 1_024 || !password) {
    throw new ApiError(401, 'AUTHENTICATION_FAILED', 'Email or password is incorrect.');
  }

  const parsedHash = parsePasswordHash(configured.passwordHash);
  if (!parsedHash) throw new ApiError(503, 'ADMIN_CREDENTIALS_NOT_CONFIGURED', 'Admin email/password credentials are not configured.');
  const passwordMatches = timingSafeEqual(derivePassword(password, parsedHash.salt), parsedHash.digest);
  const emailMatches = safeEqual(email.trim().toLowerCase(), configured.email);
  if (!passwordMatches || !emailMatches) {
    throw new ApiError(401, 'AUTHENTICATION_FAILED', 'Email or password is incorrect.');
  }
  return configured.email;
}

export async function validateAdminGithubAccess(config: ServerConfig) {
  await getGithubUser(config);
  await verifyRepositoryWriteAccess(config);
  await getGithubData(config);
}
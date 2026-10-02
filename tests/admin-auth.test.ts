import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { authenticateAdminCredentials, createAdminPasswordHash } from '../api/_lib/admin-auth.ts';

const originalEmail = process.env.ADMIN_EMAIL;
const originalPasswordHash = process.env.ADMIN_PASSWORD_HASH;

afterEach(() => {
  if (originalEmail === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = originalEmail;
  if (originalPasswordHash === undefined) delete process.env.ADMIN_PASSWORD_HASH;
  else process.env.ADMIN_PASSWORD_HASH = originalPasswordHash;
});

test('Admin credentials use an environment-configured email and salted password hash', () => {
  process.env.ADMIN_EMAIL = 'admin@example.test';
  process.env.ADMIN_PASSWORD_HASH = createAdminPasswordHash('correct horse battery staple');

  assert.equal(authenticateAdminCredentials('ADMIN@example.test', 'correct horse battery staple'), 'admin@example.test');
  assert.throws(() => authenticateAdminCredentials('other@example.test', 'correct horse battery staple'), /Email or password is incorrect/);
  assert.throws(() => authenticateAdminCredentials('admin@example.test', 'incorrect password'), /Email or password is incorrect/);
  assert.equal(process.env.ADMIN_PASSWORD_HASH.includes('correct horse battery staple'), false);
});

test('Admin authentication fails closed when server credentials are not configured', () => {
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD_HASH;
  assert.throws(() => authenticateAdminCredentials('admin@example.test', 'correct horse battery staple'), /not configured/);
});
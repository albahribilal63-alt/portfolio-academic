import assert from 'node:assert/strict';
import test from 'node:test';
import { ADMIN_ACTIVITIES_ROUTE, ADMIN_ASSETS_ROUTE, ADMIN_ISOLATED_LINKS_ROUTE, ADMIN_LOGIN_ROUTE, ADMIN_MODULES_ROUTE, ADMIN_PROFILE_ROUTE, ADMIN_ROUTE, ADMIN_YEARS_ROUTE, normalizeAdminPathname, resolveApplicationMode } from '../src/app/routing.ts';

test('canonical and legacy direct Admin routes resolve through the Admin auth gate', () => {
  for (const route of [ADMIN_ROUTE, ADMIN_LOGIN_ROUTE, ADMIN_PROFILE_ROUTE, ADMIN_YEARS_ROUTE, ADMIN_MODULES_ROUTE, ADMIN_ACTIVITIES_ROUTE, ADMIN_ASSETS_ROUTE, ADMIN_ISOLATED_LINKS_ROUTE]) {
    assert.equal(resolveApplicationMode(route, ''), 'admin', route);
  }

  assert.equal(normalizeAdminPathname('/admin-portal-x97'), ADMIN_ROUTE);
  assert.equal(normalizeAdminPathname('/admin-portal-x97/modules'), ADMIN_MODULES_ROUTE);
  assert.equal(normalizeAdminPathname('/admin-portal-x97/login'), ADMIN_LOGIN_ROUTE);
  assert.equal(resolveApplicationMode('/admin-portal-x97/activities', ''), 'admin');
});

test('Admin routing never trusts client storage or URL flags to establish authentication', () => {
  assert.equal(resolveApplicationMode('/admin', '?isAdmin=true'), 'admin');
  assert.equal(resolveApplicationMode('/admin/login', '?authenticated=true'), 'admin');
});
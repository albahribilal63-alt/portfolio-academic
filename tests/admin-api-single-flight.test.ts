import assert from 'node:assert/strict';
import test from 'node:test';
import { adminApi } from '../src/features/admin/services/adminApi.ts';

test('concurrent session and GitHub status consumers each share one API request', async () => {
  const originalFetch = globalThis.fetch;
  const requestCounts = new Map<string, number>();
  globalThis.fetch = (async (input: string | URL | Request) => {
    const path = new URL(input instanceof Request ? input.url : String(input), 'http://localhost').pathname;
    requestCounts.set(path, (requestCounts.get(path) ?? 0) + 1);
    const payload = path.endsWith('/auth/session')
      ? { success: true, authenticated: true, mode: 'local-development', developmentBypass: true }
      : { success: true, connected: true, repository: 'owner/repo', branch: 'main', dataPath: 'public/data/data.json' };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    await Promise.all([
      adminApi.getSession(),
      adminApi.getSession(),
      adminApi.getGithubStatus(),
      adminApi.getGithubStatus(),
    ]);
    assert.equal(requestCounts.get('/api/admin/auth/session'), 1);
    assert.equal(requestCounts.get('/api/admin/github/status'), 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
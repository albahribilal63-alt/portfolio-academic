import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, test } from 'node:test';
import type { VercelRequest, VercelResponse } from '../api/_lib/platform.ts';
import { parseAcademicArchive } from '../api/_lib/archive-schema.ts';
import { createSessionCookie } from '../api/_lib/session.ts';
import { getServerConfig } from '../api/_lib/config.ts';
import { MAX_ASSET_FILE_BYTES } from '../api/_lib/limits.ts';
import { isCanonicalAssetPath, moveAsset, normalizeAssetOrders, sortAssets, validateAssetForm, validateAssetName } from '../src/features/admin/assets/assets.ts';
import assetsHandler from '../api/admin/assets.ts';
import { ADMIN_ASSETS_ROUTE, resolveApplicationMode } from '../src/app/routing.ts';
import type { AcademicArchive, Asset } from '../src/types/academic.ts';

const ENVIRONMENT_KEYS = ['GITHUB_PAT', 'GITHUB_OWNER', 'GITHUB_REPO', 'GITHUB_BRANCH', 'GITHUB_DATA_PATH', 'ADMIN_SESSION_SECRET', 'NODE_ENV', 'VERCEL_ENV'] as const;
const originalEnvironment = new Map<string, string | undefined>();
const originalFetch = globalThis.fetch;

interface CapturedResponse extends VercelResponse {
  statusCode: number;
  payload: unknown;
  headers: Map<string, string | string[]>;
}

const archive: AcademicArchive & { isolatedLinks: Array<{ id: string }>; feedback: { enabled: boolean } } = {
  site: { title: 'Keep this site data' },
  profile: { name: 'Preserve this profile' },
  years: [{ id: 'year-a', name: '2025/2026', status: 'current', order: 1 }],
  modules: [{ id: 'module-a', yearId: 'year-a', code: 'M1', name: 'Module A', order: 1, visibility: 'private' }],
  activities: [{ id: 'activity-a', moduleId: 'module-a', title: 'Activity A', type: 'exercise', order: 1, visibility: 'private' }],
  isolatedLinks: [{ id: 'preserve-link', tokenHash: 'a'.repeat(64), tokenCiphertext: `v1.${'A'.repeat(16)}.${'A'.repeat(22)}.${'A'.repeat(58)}`, scopeType: 'module', scopeId: 'module-a', status: 'revoked', expiresAt: null }],
  feedback: { enabled: true },
};

function configureEnvironment() {
  process.env.GITHUB_PAT = randomBytes(32).toString('base64url');
  process.env.GITHUB_OWNER = 'test-owner';
  process.env.GITHUB_REPO = 'academic-archive';
  process.env.GITHUB_BRANCH = 'main';
  process.env.GITHUB_DATA_PATH = 'public/data/data.json';
  process.env.ADMIN_SESSION_SECRET = randomBytes(48).toString('base64url');
  process.env.NODE_ENV = 'test';
  delete process.env.VERCEL_ENV;
}

function createResponse(): CapturedResponse {
  const response = {
    statusCode: 200,
    payload: undefined as unknown,
    headers: new Map<string, string | string[]>(),
    setHeader(name: string, value: string | string[]) { this.headers.set(name.toLowerCase(), value); return this; },
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.payload = payload; return this; },
  };
  return response as unknown as CapturedResponse;
}

function adminCookie() {
  const response = createResponse();
  createSessionCookie(response, getServerConfig(), 'test-admin@example.test');
  return String(response.headers.get('set-cookie')).split(';', 1)[0]!;
}

function createRequest(method: string, body: Buffer | undefined, extraHeaders: Record<string, string> = {}): VercelRequest {
  return Object.assign(Readable.from(body ? [body] : []), {
    method,
    headers: {
      host: 'academic.test',
      origin: 'http://academic.test',
      cookie: adminCookie(),
      ...(body ? { 'content-length': String(body.byteLength) } : {}),
      ...extraHeaders,
    },
  }) as unknown as VercelRequest;
}

function jsonRequest(method: string, body: unknown) {
  return createRequest(method, Buffer.from(JSON.stringify(body)), { 'content-type': 'application/json' });
}

function archiveResponse(data: AcademicArchive, sha: string) {
  return new Response(JSON.stringify({
    encoding: 'base64',
    content: Buffer.from(JSON.stringify(data)).toString('base64'),
    sha,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function mockGithub(options: { failDataWrite?: boolean } = {}) {
  let data = structuredClone(archive);
  let dataSha = 'a'.repeat(40);
  let nextSha = 0;
  let failDataWrite = options.failDataWrite ?? false;
  const files = new Map<string, { content: Buffer; sha: string }>();
  const calls: Array<{ method: string; path: string; authorization?: string }> = [];
  const newSha = () => (++nextSha).toString(16).padStart(40, '0');

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? 'GET';
    const path = decodeURIComponent(url.pathname.split('/contents/')[1] ?? '');
    calls.push({ method, path, authorization: new Headers(init?.headers).get('Authorization') ?? undefined });
    if (path === 'public/data/data.json' && method === 'GET') return archiveResponse(data, dataSha);
    if (path === 'public/data/data.json' && method === 'PUT') {
      if (failDataWrite) {
        failDataWrite = false;
        return new Response(JSON.stringify({ message: 'Validation Failed' }), { status: 422 });
      }
      const payload = JSON.parse(String(init?.body)) as { content: string; sha: string };
      if (payload.sha !== dataSha) return new Response(JSON.stringify({ message: 'Conflict' }), { status: 409 });
      data = JSON.parse(Buffer.from(payload.content, 'base64').toString('utf8')) as typeof archive;
      dataSha = newSha();
      return new Response(JSON.stringify({ content: { sha: dataSha }, commit: { sha: newSha() } }), { status: 200 });
    }
    if (path.startsWith('public/storage/docs/')) {
      const existing = files.get(path);
      if (method === 'GET' && existing) {
        return new Response(JSON.stringify({ encoding: 'base64', content: existing.content.toString('base64'), sha: existing.sha }), { status: 200 });
      }
      if (method === 'GET') return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      if (method === 'PUT') {
        const payload = JSON.parse(String(init?.body)) as { content: string; sha?: string };
        if (existing && payload.sha !== existing.sha) return new Response(JSON.stringify({ message: 'Conflict' }), { status: 409 });
        const sha = newSha();
        files.set(path, { content: Buffer.from(payload.content, 'base64'), sha });
        return new Response(JSON.stringify({ content: { sha } }), { status: 200 });
      }
      if (method === 'DELETE') {
        const payload = JSON.parse(String(init?.body)) as { sha: string };
        if (!existing || payload.sha !== existing.sha) return new Response(JSON.stringify({ message: 'Conflict' }), { status: 409 });
        files.delete(path);
        return new Response(JSON.stringify({ commit: { sha: newSha() } }), { status: 200 });
      }
    }
    throw new Error(`Unexpected mocked GitHub request: ${method} ${url.pathname}`);
  }) as typeof fetch;
  return { files, calls, readData: () => data };
}

beforeEach(() => {
  for (const key of ENVIRONMENT_KEYS) originalEnvironment.set(key, process.env[key]);
  configureEnvironment();
  globalThis.fetch = (async () => { throw new Error('Unexpected GitHub call.'); }) as typeof fetch;
});

afterEach(() => {
  for (const key of ENVIRONMENT_KEYS) {
    const value = originalEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  originalEnvironment.clear();
  globalThis.fetch = originalFetch;
});

test('asset validation rejects unsupported names and unsafe paths and accepts canonical storage paths', () => {
  assert.equal(validateAssetName('TP01.pdf'), undefined);
  assert.match(validateAssetName('../TP01.pdf') ?? '', /unsupported characters/i);
    assert.equal(validateAssetName('source.ts'), undefined);
    assert.match(validateAssetName('snippet.exe') ?? '', /source-code file/i);
  assert.equal(isCanonicalAssetPath('public/storage/docs/asset_1.pdf', 'asset_1', 'PDF'), true);
  assert.equal(isCanonicalAssetPath('public/storage/docs/../data.json', 'asset_1', 'PDF'), false);
  assert.equal(isCanonicalAssetPath('C:\\private.pdf', 'asset_1', 'PDF'), false);
});

test('Files & Assets is an authenticated Admin route', () => {
  assert.equal(ADMIN_ASSETS_ROUTE, '/admin/files');
  assert.equal(resolveApplicationMode(ADMIN_ASSETS_ROUTE, ''), 'admin');
});

test('asset form requires an existing activity, valid order, supported type, and visibility', () => {
  const activities = archive.activities!;
  assert.equal(validateAssetForm({ activityId: 'activity-a', name: 'TP01.pdf', order: '1', visibility: 'private' }, activities).valid, true);
  assert.ok(validateAssetForm({ activityId: 'activity-a', name: 'TP01.pdf', order: '0', visibility: 'private' }, activities).errors.order);
  assert.equal(validateAssetForm({ activityId: 'missing', name: 'TP01.pdf', order: '1', visibility: 'private' }, activities).errors.activityId, 'Select an existing activity.');
    assert.ok(validateAssetForm({ activityId: 'activity-a', name: 'TP01.exe', order: 'x', visibility: 'public-ish' }, activities).errors.name);
});

test('asset ordering is normalized per activity and reorders without affecting other activities', () => {
  const assets: Asset[] = [
    { id: 'asset-a', activityId: 'activity-a', name: 'A.pdf', type: 'PDF', path: 'public/storage/docs/asset-a.pdf', order: 1, visibility: 'private' },
    { id: 'asset-b', activityId: 'activity-a', name: 'B.pdf', type: 'PDF', path: 'public/storage/docs/asset-b.pdf', order: 2, visibility: 'public' },
    { id: 'asset-c', activityId: 'activity-b', name: 'C.pdf', type: 'PDF', path: 'public/storage/docs/asset-c.pdf', order: 7, visibility: 'unlisted' },
  ];
  const moved = moveAsset(assets, 'asset-a', 1);
  assert.equal(moveAsset(assets, 'asset-a', -1), assets);
  assert.equal(moveAsset(assets, 'asset-b', 1), assets);
  const movedOrders: Array<[string, number]> = moved
    .filter((asset) => asset.activityId === 'activity-a')
    .map((asset): [string, number] => [asset.id, asset.order]);
  assert.deepEqual(movedOrders.sort((left, right) => left[1] - right[1]), [['asset-b', 1], ['asset-a', 2]]);
  assert.equal(moved.find((asset) => asset.id === 'asset-c')?.order, 7);
  assert.deepEqual(sortAssets(moved, archive.activities!).filter((asset) => asset.activityId === 'activity-a').map((asset) => asset.id), ['asset-b', 'asset-a']);
  for (const asset of moved) {
    const original = assets.find((item) => item.id === asset.id)!;
    assert.deepEqual({ ...asset, order: original.order }, original);
    assert.equal(asset.activityId, original.activityId);
    assert.equal(asset.path, original.path);
  }
  assert.deepEqual(normalizeAssetOrders(moved).map((asset) => [asset.id, asset.order]), [['asset-b', 1], ['asset-a', 2], ['asset-c', 1]]);
});

test('archive schema rejects dangling activity references, duplicate asset IDs, and noncanonical paths', () => {
  const asset: Asset = { id: 'asset-a', activityId: 'activity-a', name: 'TP01.pdf', type: 'PDF', path: 'public/storage/docs/asset-a.pdf', order: 1, visibility: 'private' };
  assert.doesNotThrow(() => parseAcademicArchive({ ...archive, assets: [asset] }));
  assert.throws(() => parseAcademicArchive({ ...archive, assets: [{ ...asset, activityId: 'missing' }] }));
  assert.throws(() => parseAcademicArchive({ ...archive, assets: [asset, asset] }));
  assert.throws(() => parseAcademicArchive({ ...archive, assets: [{ ...asset, path: 'public/storage/docs/../../data.json' }] }));
  assert.throws(() => parseAcademicArchive({ ...archive, assets: [{ ...asset, order: 0 }] }));
  assert.throws(() => parseAcademicArchive({ ...archive, assets: [asset, { ...asset, id: 'asset-b', path: 'public/storage/docs/asset-b.pdf' }] }));
});

test('asset API uploads and persists binary content with its activity metadata', async () => {
  const github = mockGithub();
  const content = Buffer.from('%PDF-test-content');
  const response = createResponse();
  await assetsHandler(createRequest('POST', content, {
    'content-type': 'application/octet-stream',
    'x-asset-metadata': JSON.stringify({ activityId: 'activity-a', name: 'TP01.pdf', order: 1, visibility: 'private' }),
  }), response);
  assert.equal(response.statusCode, 200);
  const payload = response.payload as { asset: Asset };
  assert.equal(payload.asset.activityId, 'activity-a');
  assert.equal(payload.asset.path, `public/storage/docs/${payload.asset.id}.pdf`);
  assert.equal(github.files.get(payload.asset.path)?.content.toString(), content.toString());
  assert.equal(github.readData().assets?.[0]?.id, payload.asset.id);
  assert.ok(github.calls.every((call) => call.authorization?.startsWith('Bearer ')));
});

test('asset API stores supported source code as a CODE asset for scoped rendering', async () => {
  const github = mockGithub();
  const source = Buffer.from('function add(a, b) { return a + b; }\n', 'utf8');
  const response = createResponse();
  await assetsHandler(createRequest('POST', source, {
    'content-type': 'application/octet-stream',
    'x-asset-metadata': JSON.stringify({ activityId: 'activity-a', name: 'solution.js', order: 1, visibility: 'private' }),
  }), response);
  assert.equal(response.statusCode, 200);
  const asset = (response.payload as { asset: Asset }).asset;
  assert.equal(asset.type, 'CODE');
  assert.equal(asset.name, 'solution.js');
  assert.equal(asset.path, `public/storage/docs/${asset.id}.code`);
  assert.equal(github.readData().assets?.[0]?.type, 'CODE');
  assert.equal(github.files.get(asset.path)?.content.toString('utf8'), source.toString('utf8'));
});

test('asset API rejects invalid activity and file types before any GitHub write', async () => {
  const github = mockGithub();
  const invalidActivityResponse = createResponse();
  await assetsHandler(createRequest('POST', Buffer.from('pdf'), {
    'content-type': 'application/octet-stream',
    'x-asset-metadata': JSON.stringify({ activityId: 'missing', name: 'TP01.pdf', order: 1, visibility: 'private' }),
  }), invalidActivityResponse);
  assert.equal(invalidActivityResponse.statusCode, 400);
  assert.equal(github.calls.some((call) => call.method === 'PUT'), false);

  const unsupportedResponse = createResponse();
  await assetsHandler(createRequest('POST', Buffer.from('source'), {
    'content-type': 'application/octet-stream',
    'x-asset-metadata': JSON.stringify({ activityId: 'activity-a', name: 'source.exe', order: 1, visibility: 'public' }),
  }), unsupportedResponse);
  assert.equal(unsupportedResponse.statusCode, 415);
  assert.equal(github.calls.some((call) => call.method === 'PUT'), false);

  const invalidOrderResponse = createResponse();
  await assetsHandler(createRequest('POST', Buffer.from('pdf'), {
    'content-type': 'application/octet-stream',
    'x-asset-metadata': JSON.stringify({ activityId: 'activity-a', name: 'TP01.pdf', order: 0, visibility: 'private' }),
  }), invalidOrderResponse);
  assert.equal(invalidOrderResponse.statusCode, 400);
  assert.equal(github.calls.some((call) => call.method === 'PUT'), false);
});

test('asset API requires an Admin session and rejects uploads beyond the derived request limit', async () => {
  const github = mockGithub();
  const unauthorized = createResponse();
  await assetsHandler(createRequest('POST', Buffer.from('pdf'), {
    cookie: '',
    'content-type': 'application/octet-stream',
    'x-asset-metadata': JSON.stringify({ activityId: 'activity-a', name: 'TP01.pdf', order: 1, visibility: 'private' }),
  }), unauthorized);
  assert.equal(unauthorized.statusCode, 401);

  const oversized = createResponse();
  await assetsHandler(createRequest('POST', Buffer.alloc(MAX_ASSET_FILE_BYTES + 1), {
    'content-type': 'application/octet-stream',
    'x-asset-metadata': JSON.stringify({ activityId: 'activity-a', name: 'TP01.pdf', order: 1, visibility: 'private' }),
  }), oversized);
  assert.equal(oversized.statusCode, 413);
  assert.equal(github.calls.length, 0);
});

test('metadata edit and replacement preserve asset identity and relation; delete removes the file and entry', async () => {
  const github = mockGithub();
  const uploadResponse = createResponse();
  await assetsHandler(createRequest('POST', Buffer.from('pdf-v1'), {
    'content-type': 'application/octet-stream',
    'x-asset-metadata': JSON.stringify({ activityId: 'activity-a', name: 'TP01.pdf', order: 1, visibility: 'private' }),
  }), uploadResponse);
  const created = (uploadResponse.payload as { asset: Asset }).asset;

  const editResponse = createResponse();
  await assetsHandler(jsonRequest('PATCH', { id: created.id, activityId: 'activity-a', name: 'TP01-updated.pdf', order: 3, visibility: 'public' }), editResponse);
  assert.equal(editResponse.statusCode, 200);
  const edited = github.readData().assets?.[0];
  assert.equal(edited?.id, created.id);
  assert.equal(edited?.order, 3);
  assert.equal(edited?.visibility, 'public');
  assert.equal(github.files.get(created.path)?.content.toString(), 'pdf-v1');

  const replaceResponse = createResponse();
  await assetsHandler(createRequest('PUT', Buffer.from('pdf-v2'), {
    'content-type': 'application/octet-stream',
    'x-asset-metadata': JSON.stringify({ assetId: created.id, filename: 'replacement.zip' }),
  }), replaceResponse);
  assert.equal(replaceResponse.statusCode, 200);
  const replacedAsset = (replaceResponse.payload as { asset: Asset }).asset;
  assert.equal(replacedAsset.id, created.id);
  assert.equal(replacedAsset.type, 'ZIP');
  assert.notEqual(replacedAsset.path, created.path);
  assert.equal(github.readData().assets?.[0]?.activityId, 'activity-a');
  assert.equal(github.files.has(created.path), false);
  assert.equal(github.files.get(replacedAsset.path)?.content.toString(), 'pdf-v2');

  const deleteResponse = createResponse();
  await assetsHandler(jsonRequest('DELETE', { id: created.id }), deleteResponse);
  assert.equal(deleteResponse.statusCode, 200);
  assert.equal(github.readData().assets?.length, 0);
  assert.equal(github.files.has(replacedAsset.path), false);
  assert.equal(github.readData().site.title, 'Keep this site data');
  assert.deepEqual(github.readData().isolatedLinks, [{ id: 'preserve-link', tokenHash: 'a'.repeat(64), tokenCiphertext: `v1.${'A'.repeat(16)}.${'A'.repeat(22)}.${'A'.repeat(58)}`, scopeType: 'module', scopeId: 'module-a', status: 'revoked', expiresAt: null }]);
  assert.deepEqual(github.readData().feedback, { enabled: true });
});

test('asset upload rolls back the repository file when data.json persistence fails', async () => {
  const github = mockGithub({ failDataWrite: true });
  const response = createResponse();
  await assetsHandler(createRequest('POST', Buffer.from('pdf-failure'), {
    'content-type': 'application/octet-stream',
    'x-asset-metadata': JSON.stringify({ activityId: 'activity-a', name: 'TP01.pdf', order: 1, visibility: 'private' }),
  }), response);
  assert.equal(response.statusCode, 422);
  assert.equal(github.readData().assets, undefined);
  assert.equal(github.files.size, 0);
});

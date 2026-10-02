import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, test } from 'node:test';
import type { VercelRequest, VercelResponse } from '../api/_lib/platform.ts';
import { getServerConfig } from '../api/_lib/config.ts';
import { createIsolatedToken, encryptIsolatedToken } from '../api/_lib/isolated-links.ts';
import { createSessionCookie } from '../api/_lib/session.ts';
import adminPhotoHandler from '../api/admin/profile-photo.ts';
import isolatedPhotoHandler from '../api/isolated/profile-photo.ts';
import type { AcademicArchive, IsolatedLink } from '../src/types/academic.ts';

const ENVIRONMENT_KEYS = ['GITHUB_PAT', 'GITHUB_OWNER', 'GITHUB_REPO', 'GITHUB_BRANCH', 'GITHUB_DATA_PATH', 'ADMIN_SESSION_SECRET', 'ADMIN_LOCAL_BYPASS', 'NODE_ENV', 'VERCEL_ENV'] as const;
const originalEnvironment = new Map<string, string | undefined>();
const originalFetch = globalThis.fetch;

interface CapturedResponse extends VercelResponse {
  statusCode: number;
  payload: unknown;
  body: Buffer | undefined;
  headers: Map<string, string | string[]>;
}

const archive: AcademicArchive = {
  site: { title: 'Portfolio' },
  profile: { name: 'Student Name', institution: 'FSSM', program: 'Informatique', branch: 'Web', semester: 'S2' },
  years: [{ id: 'year-one', name: '2025/2026', status: 'current', order: 1 }],
  modules: [{ id: 'module-one', yearId: 'year-one', code: 'WEB2', name: 'Web 2', order: 1, visibility: 'private' }],
  activities: [{ id: 'activity-one', moduleId: 'module-one', title: 'TP 1', type: 'exercise', order: 1, visibility: 'private' }],
  assets: [],
  isolatedLinks: [],
};

function configureEnvironment() {
  process.env.GITHUB_PAT = randomBytes(32).toString('base64url');
  process.env.GITHUB_OWNER = 'test-owner';
  process.env.GITHUB_REPO = 'academic-archive';
  process.env.GITHUB_BRANCH = 'main';
  process.env.GITHUB_DATA_PATH = 'public/data/data.json';
  process.env.ADMIN_SESSION_SECRET = randomBytes(48).toString('base64url');
  process.env.NODE_ENV = 'test';
  delete process.env.ADMIN_LOCAL_BYPASS;
  delete process.env.VERCEL_ENV;
}

function createResponse(): CapturedResponse {
  const response = {
    statusCode: 200,
    payload: undefined as unknown,
    body: undefined as Buffer | undefined,
    headers: new Map<string, string | string[]>(),
    setHeader(name: string, value: string | string[]) { this.headers.set(name.toLowerCase(), value); return this; },
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.payload = payload; return this; },
    end(body?: string | Uint8Array) { this.body = body === undefined ? undefined : Buffer.from(body); return this; },
  };
  return response as unknown as CapturedResponse;
}

function adminCookie() {
  const response = createResponse();
  createSessionCookie(response, getServerConfig(), 'photo-admin@example.test');
  return String(response.headers.get('set-cookie')).split(';', 1)[0]!;
}

function createRequest(method: string, body: Buffer | undefined, headers: Record<string, string> = {}, url: string) {
  return Object.assign(Readable.from(body ? [body] : []), {
    method,
    url,
    headers: {
      host: 'academic.test',
      origin: 'http://academic.test',
      ...(body ? { 'content-length': String(body.byteLength) } : {}),
      ...headers,
    },
  }) as unknown as VercelRequest;
}

function githubDataResponse(data: AcademicArchive, sha: string) {
  return new Response(JSON.stringify({
    encoding: 'base64',
    content: Buffer.from(JSON.stringify(data)).toString('base64'),
    sha,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function createGithubMock(initialData: AcademicArchive) {
  let data = structuredClone(initialData);
  let dataSha = 'a'.repeat(40);
  let shaCounter = 0;
  const files = new Map<string, { content: Buffer; sha: string }>();
  const requests: Array<{ method: string; path: string; authorization: string | null }> = [];
  const nextSha = () => (++shaCounter).toString(16).padStart(40, '0');

  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const path = decodeURIComponent(url.pathname.split('/contents/')[1] ?? '');
    requests.push({ method, path, authorization: new Headers(init.headers).get('Authorization') });

    if (path === 'public/data/data.json' && method === 'GET') return githubDataResponse(data, dataSha);
    if (path === 'public/data/data.json' && method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { content: string; sha: string };
      if (body.sha !== dataSha) return new Response('{}', { status: 409 });
      data = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')) as AcademicArchive;
      dataSha = nextSha();
      return new Response(JSON.stringify({ content: { sha: dataSha }, commit: { sha: nextSha() } }), { status: 200 });
    }

    if (path.startsWith('public/storage/profile/')) {
      const existing = files.get(path);
      if (method === 'GET' && existing) {
        return new Response(JSON.stringify({ encoding: 'base64', content: existing.content.toString('base64'), sha: existing.sha }), { status: 200 });
      }
      if (method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { content: string };
        const sha = nextSha();
        files.set(path, { content: Buffer.from(body.content, 'base64'), sha });
        return new Response(JSON.stringify({ content: { sha } }), { status: 200 });
      }
      if (method === 'DELETE' && existing) {
        files.delete(path);
        return new Response(JSON.stringify({ commit: { sha: nextSha() } }), { status: 200 });
      }
    }

    return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
  }) as typeof fetch;

  return { files, requests, readData: () => data };
}

beforeEach(() => {
  for (const key of ENVIRONMENT_KEYS) originalEnvironment.set(key, process.env[key]);
  configureEnvironment();
  globalThis.fetch = (async () => { throw new Error('Unexpected GitHub request.'); }) as typeof fetch;
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

test('profile photo upload, Admin preview, scoped Professor delivery, and removal stay server-side', async () => {
  const token = createIsolatedToken();
  const link: IsolatedLink = {
    id: 'profile-link',
    tokenHash: token.tokenHash,
    tokenCiphertext: encryptIsolatedToken(getServerConfig(), token.token),
    scopeType: 'activity',
    scopeId: 'activity-one',
    status: 'active',
    expiresAt: null,
  };
  const testArchive = { ...archive, isolatedLinks: [link] };
  const github = createGithubMock(testArchive);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYoYAAAAASUVORK5CYII=', 'base64');

  const unauthorized = createResponse();
  await adminPhotoHandler(createRequest('GET', undefined, {}, '/api/admin/profile-photo'), unauthorized);
  assert.equal(unauthorized.statusCode, 401);

  const upload = createResponse();
  await adminPhotoHandler(createRequest('POST', png, {
    cookie: adminCookie(),
    'content-type': 'application/octet-stream',
    'x-profile-photo-name': 'portrait.png',
  }, '/api/admin/profile-photo'), upload);
  assert.equal(upload.statusCode, 200);
  const uploaded = upload.payload as { photo: { id: string; path: string; type: string }; contentSha: string };
  assert.equal(uploaded.photo.type, 'PNG');
  assert.match(uploaded.photo.path, /^public\/storage\/profile\/[A-Za-z0-9_-]+\.png$/);
  assert.deepEqual(github.files.get(uploaded.photo.path)?.content, png);
  assert.deepEqual(github.readData().profile?.photo, uploaded.photo);

  const adminPreview = createResponse();
  await adminPhotoHandler(createRequest('GET', undefined, { cookie: adminCookie() }, '/api/admin/profile-photo'), adminPreview);
  assert.equal(adminPreview.statusCode, 200);
  assert.equal(adminPreview.headers.get('content-type'), 'image/png');
  assert.equal(adminPreview.body?.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');

  const professorPreview = createResponse();
  await isolatedPhotoHandler(createRequest('GET', undefined, {}, `/api/isolated/profile-photo?token=${encodeURIComponent(token.token)}`), professorPreview);
  assert.equal(professorPreview.statusCode, 200);
  assert.equal(professorPreview.headers.get('content-type'), 'image/png');
  assert.deepEqual(professorPreview.body, png);

  const invalidProfessorToken = createResponse();
  await isolatedPhotoHandler(createRequest('GET', undefined, {}, '/api/isolated/profile-photo?token=invalid'), invalidProfessorToken);
  assert.equal(invalidProfessorToken.statusCode, 404);

  const removal = createResponse();
  await adminPhotoHandler(createRequest('DELETE', Buffer.from('{}'), {
    cookie: adminCookie(),
    'content-type': 'application/json',
  }, '/api/admin/profile-photo'), removal);
  assert.equal(removal.statusCode, 200);
  assert.equal(github.readData().profile?.photo, undefined);
  assert.equal(github.files.size, 0);
  assert.equal(github.requests.every((request) => request.method === 'GET' || request.authorization?.startsWith('Bearer ')), true);
});
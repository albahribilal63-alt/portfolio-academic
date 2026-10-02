import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, test } from 'node:test';
import type { VercelRequest, VercelResponse } from '../api/_lib/platform.ts';
import { expireCookieForEnvironment, getAdminAuthContext, isLocalAdminDevelopmentRequest } from '../api/_lib/admin-session.ts';
import { parseAcademicArchive, validateAcademicYearsTransition } from '../api/_lib/archive-schema.ts';
import { getServerConfig, isSecureDeployment } from '../api/_lib/config.ts';
import { ApiError } from '../api/_lib/errors.ts';
import { MAX_DATA_BODY_BYTES as ARCHIVE_MAX_BYTES } from '../api/_lib/limits.ts';
import { MAX_DATA_BODY_BYTES, readJsonBody } from '../api/_lib/http.ts';
import { getGithubData } from '../api/_lib/github.ts';
import type { AcademicArchive } from '../src/types/academic.ts';
import { createAdminPasswordHash } from '../api/_lib/admin-auth.ts';
import { createSessionCookie, readAdminSession, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from '../api/_lib/session.ts';
import loginHandler from '../api/admin/auth/login.ts';
import logoutHandler from '../api/admin/auth/logout.ts';
import sessionHandler from '../api/admin/auth/session.ts';
import statusHandler from '../api/admin/github/status.ts';
import dataHandler from '../api/admin/data.ts';

const ENVIRONMENT_KEYS = [
  'GITHUB_PAT',
  'GITHUB_OWNER',
  'GITHUB_REPO',
  'GITHUB_BRANCH',
  'GITHUB_DATA_PATH',
  'ADMIN_SESSION_SECRET',
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD_HASH',
  'ADMIN_LOCAL_BYPASS',
  'NODE_ENV',
  'VERCEL_ENV',
] as const;

const originalEnvironment = new Map<string, string | undefined>();
const originalFetch = globalThis.fetch;
const TEST_ADMIN_EMAIL = 'test-admin@example.test';
const TEST_ADMIN_PASSWORD = 'a-test-password-with-sufficient-length';
const TEST_ADMIN_PASSWORD_HASH = createAdminPasswordHash(TEST_ADMIN_PASSWORD);

interface CapturedResponse extends VercelResponse {
  statusCode: number;
  payload: unknown;
  headers: Map<string, string | string[]>;
}

function configureTestEnvironment() {
  process.env.GITHUB_PAT = randomBytes(32).toString('base64url');
  process.env.GITHUB_OWNER = 'test-owner';
  process.env.GITHUB_REPO = 'academic-archive';
  process.env.GITHUB_BRANCH = 'main';
  process.env.GITHUB_DATA_PATH = 'public/data/data.json';
  process.env.ADMIN_SESSION_SECRET = randomBytes(48).toString('base64url');
  process.env.ADMIN_EMAIL = TEST_ADMIN_EMAIL;
  process.env.ADMIN_PASSWORD_HASH = TEST_ADMIN_PASSWORD_HASH;
  process.env.NODE_ENV = 'test';
  delete process.env.ADMIN_LOCAL_BYPASS;
  delete process.env.VERCEL_ENV;
}

beforeEach(() => {
  for (const key of ENVIRONMENT_KEYS) originalEnvironment.set(key, process.env[key]);
  configureTestEnvironment();
  globalThis.fetch = (async () => {
    throw new Error('Unexpected GitHub request in test.');
  }) as typeof fetch;
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

function createRequest(
  method: string,
  body = '',
  headers: Record<string, string> = {},
): VercelRequest {
  const bodyBuffer = Buffer.from(body, 'utf8');
  const requestHeaders = {
    host: 'academic.test',
    origin: 'http://academic.test',
    ...(body ? {
      'content-type': 'application/json',
      'content-length': String(bodyBuffer.byteLength),
    } : {}),
    ...headers,
  };
  return Object.assign(Readable.from(body ? [bodyBuffer] : []), {
    method,
    headers: requestHeaders,
  }) as unknown as VercelRequest;
}

function createResponse(): CapturedResponse {
  const response = {
    statusCode: 200,
    payload: undefined as unknown,
    headers: new Map<string, string | string[]>(),
    setHeader(name: string, value: string | string[]) {
      this.headers.set(name.toLowerCase(), value);
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
  return response as unknown as CapturedResponse;
}

function cookieFrom(response: CapturedResponse): string {
  const value = response.headers.get('set-cookie');
  assert.equal(typeof value, 'string');
  return (value as string).split(';', 1)[0] ?? '';
}

function createAuthenticatedCookie() {
  const response = createResponse();
  const serverConfig = getServerConfig();
  createSessionCookie(response, serverConfig, 'test-admin@example.test');
  return cookieFrom(response);
}

const archive = {
  site: {},
  profile: {},
  years: [],
};

const completeProfileArchive = {
  ...archive,
  profile: {
    lastName: 'ELBAHRI',
    firstName: 'Bilal',
    filiere: 'IAP3',
    section: 'Section I',
    tdGroup: 'Gr_01',
    name: 'Student Name',
    institution: 'Academic University',
    cne: 'CNE-001',
    apogee: '00012345',
    program: 'Computer Science',
    branch: 'Software Engineering',
  },
};

function githubFileResponse(sha = 'a'.repeat(40), data: unknown = archive) {
  return new Response(JSON.stringify({
    encoding: 'base64',
    content: Buffer.from(JSON.stringify(data), 'utf8').toString('base64'),
    sha,
    name: 'data.json',
    download_url: 'https://example.invalid/private',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function successfulGithubMock() {
  const requests: Array<{ url: string; headers: Headers; body?: string }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push({
      url,
      headers: new Headers(init?.headers),
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    });
    if (url === 'https://api.github.com/user') {
      return new Response(JSON.stringify({ login: 'test-admin', private_data: 'not returned' }), { status: 200 });
    }
    if (url === 'https://api.github.com/repos/test-owner/academic-archive') {
      return new Response(JSON.stringify({ permissions: { push: true, admin: false } }), { status: 200 });
    }
    if (url === 'https://api.github.com/repos/test-owner/academic-archive/contents/public/data/data.json?ref=main') {
      return githubFileResponse();
    }
    throw new Error('Unexpected GitHub request URL.');
  }) as typeof fetch;
  return requests;
}

test('archive schema accepts the Phase 1 empty archive and rejects unknown structure', () => {
  assert.deepEqual(parseAcademicArchive(archive), archive);
  const futureProperties = {
    ...archive,
    futureSettings: { revision: 2 },
    profile: { legacyCode: 'preserve-me' },
    years: [{ id: 'year', name: 'Year 2025', status: 'upcoming', order: 1, modules: [], ordering: { locked: true } }],
  };
  assert.deepEqual(parseAcademicArchive(futureProperties), futureProperties);
  assert.throws(() => parseAcademicArchive({ ...archive, years: [{ id: 'y', name: 'Year 2025', status: 'upcoming', modules: [{ id: 'm', title: 'Module' }] }] }), ApiError);
  assert.equal(MAX_DATA_BODY_BYTES, ARCHIVE_MAX_BYTES);

  const linkedArchive = {
    site: {},
    profile: {},
    years: [{
      id: 'year',
      name: 'Year 2025',
      status: 'upcoming',
      order: 1,
      modules: [{
        id: 'module',
        title: 'Module',
        activities: [{
          id: 'activity',
          title: 'Activity',
          assets: [{ id: 'asset', name: 'Asset', kind: 'link', url: 'https://example.test/resource' }],
        }],
      }],
    }],
  };
  assert.doesNotThrow(() => parseAcademicArchive(linkedArchive));
  assert.throws(() => parseAcademicArchive({
    ...linkedArchive,
    years: [{
      ...linkedArchive.years[0],
      modules: [{
        ...linkedArchive.years[0]!.modules[0]!,
        activities: [{
          ...linkedArchive.years[0]!.modules[0]!.activities[0]!,
          assets: [{ ...linkedArchive.years[0]!.modules[0]!.activities[0]!.assets[0]!, url: 'javascript:alert(1)' }],
        }],
      }],
    }],
  }), ApiError);
});

test('academic years schema enforces unique IDs/names, exact statuses, one Current, and contiguous order', () => {
  const makeYear = (id: string, name: string, order: number, status: string = 'upcoming') => ({
    id,
    name,
    order,
    status,
    modules: [],
  });
  const validArchive = { site: {}, profile: {}, years: [makeYear('year-a', '2025/2026', 1, 'previous'), makeYear('year-b', '2026/2027', 2, 'current')] };
  assert.deepEqual(parseAcademicArchive(validArchive), validArchive);
  assert.doesNotThrow(() => parseAcademicArchive({ ...validArchive, years: [...validArchive.years].reverse().map((year) => ({ ...year, order: year.order === 1 ? 2 : 1 })) }));
  assert.deepEqual(parseAcademicArchive({ site: {}, profile: {}, years: [] }).years, []);

  const invalidArchives = [
    { ...validArchive, years: [makeYear('same-id', '2025/2026', 1), makeYear('same-id', '2026/2027', 2)] },
    { ...validArchive, years: [makeYear('year-a', '2025/2026', 1), makeYear('year-b', ' 2025/2026 ', 2)] },
    { ...validArchive, years: [makeYear('year-a', '2025/2026', 1), makeYear('year-b', '2026/2027', 2, 'active')] },
    { ...validArchive, years: [makeYear('year-a', '2025/2026', 1, 'current'), makeYear('year-b', '2026/2027', 2, 'current')] },
    { ...validArchive, years: [makeYear('year-a', '2025/2026', 1), makeYear('year-b', '2026/2027', 3)] },
  ];
  for (const invalidArchive of invalidArchives) {
    assert.throws(() => parseAcademicArchive(invalidArchive), ApiError);
  }
});

test('academic year transition blocks module cascade and changed IDs but permits empty deletion', () => {
  const existingYear = { id: 'year-a', name: '2025/2026', status: 'previous' as const, order: 1, modules: [] };
  assert.doesNotThrow(() => validateAcademicYearsTransition([existingYear], []));
  assert.throws(
    () => validateAcademicYearsTransition([{ ...existingYear, modules: [{ id: 'module-a', title: 'Module', activities: [] }] }], []),
    (error: unknown) => error instanceof ApiError && error.code === 'YEAR_HAS_MODULES',
  );
  assert.throws(
    () => validateAcademicYearsTransition([existingYear], [{ ...existingYear, id: 'year-b' }]),
    (error: unknown) => error instanceof ApiError && error.code === 'YEAR_ID_IMMUTABLE',
  );
});

test('data PUT independently blocks deleting a module-bearing year without issuing a GitHub write', async () => {
  const currentData = {
    site: {},
    profile: {},
    years: [{
      id: 'year-a',
      name: '2025/2026',
      status: 'current',
      order: 1,
      modules: [{ id: 'module-a', title: 'Module', activities: [] }],
    }],
  };
  let getCount = 0;
  let putCount = 0;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      putCount += 1;
      return new Response('{}', { status: 200 });
    }
    getCount += 1;
    return githubFileResponse('a'.repeat(40), currentData);
  }) as typeof fetch;

  const response = createResponse();
  await dataHandler(createRequest('PUT', JSON.stringify({
    data: { ...currentData, years: [] },
    sha: 'a'.repeat(40),
  }), { cookie: createAuthenticatedCookie() }), response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.payload, {
    success: false,
    error: 'YEAR_HAS_MODULES',
    message: 'This academic year contains modules and cannot be deleted in this phase.',
  });
  assert.equal(getCount, 1);
  assert.equal(putCount, 0);
});

test('data PUT rejects a stale client SHA before attempting to overwrite GitHub', async () => {
  let putCount = 0;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      putCount += 1;
      return new Response('{}', { status: 200 });
    }
    return githubFileResponse('b'.repeat(40));
  }) as typeof fetch;

  const response = createResponse();
  await dataHandler(createRequest('PUT', JSON.stringify({
    data: archive,
    sha: 'a'.repeat(40),
  }), { cookie: createAuthenticatedCookie() }), response);

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.payload, {
    success: false,
    error: 'GITHUB_CONFLICT',
    message: 'The academic data changed on GitHub. Reload the current data before saving again.',
  });
  assert.equal(putCount, 0);
});

test('data PUT rejects replacing an existing academic year ID while preserving all other fields', async () => {
  const currentData = {
    site: {},
    profile: {},
    years: [{ id: 'year-a', name: '2025/2026', status: 'previous', order: 1, modules: [] }],
  };
  let putCount = 0;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') putCount += 1;
    return init?.method === 'PUT'
      ? new Response('{}', { status: 200 })
      : githubFileResponse('a'.repeat(40), currentData);
  }) as typeof fetch;

  const response = createResponse();
  await dataHandler(createRequest('PUT', JSON.stringify({
    data: { ...currentData, years: [{ ...currentData.years[0], id: 'year-b' }] },
    sha: 'a'.repeat(40),
  }), { cookie: createAuthenticatedCookie() }), response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.payload && typeof response.payload === 'object' && 'error' in response.payload ? response.payload.error : undefined, 'YEAR_ID_IMMUTABLE');
  assert.equal(putCount, 0);
});

test('years-only PUT preserves unchanged incomplete profile and unknown non-year data', async () => {
  const currentData = {
    site: { title: 'Archive', futureSite: { keep: true } },
    profile: { name: 'Legacy profile', futureProfile: 'keep' },
    years: [{ id: 'year-a', name: '2025/2026', status: 'upcoming', order: 1, futureYear: 'keep' }],
    futureTopLevel: { preserve: ['all'] },
  };
  const updatedData = {
    ...currentData,
    years: [{ ...currentData.years[0], status: 'current' }],
  };
  let putBody = '';
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      putBody = String(init.body ?? '');
      return new Response(JSON.stringify({
        content: { sha: 'b'.repeat(40) },
        commit: { sha: 'c'.repeat(40) },
      }), { status: 200 });
    }
    return githubFileResponse('a'.repeat(40), currentData);
  }) as typeof fetch;

  const response = createResponse();
  await dataHandler(createRequest('PUT', JSON.stringify({
    data: updatedData,
    sha: 'a'.repeat(40),
    message: 'Update academic years',
  }), { cookie: createAuthenticatedCookie() }), response);

  assert.equal(response.statusCode, 200);
  const writtenContent = JSON.parse(Buffer.from(
    (JSON.parse(putBody) as { content: string }).content,
    'base64',
  ).toString('utf8')) as unknown;
  assert.deepEqual(writtenContent, updatedData);
});

test('server configuration fails closed when a required secret is absent', () => {
  delete process.env.ADMIN_SESSION_SECRET;
  assert.throws(
    () => getServerConfig(),
    (error: unknown) => error instanceof ApiError
      && error.status === 503
      && error.safeMessage === 'Admin API is not configured.',
  );
});

test('localhost bypass requires explicit development opt-in and exact loopback host matching', () => {
  process.env.NODE_ENV = 'development';
  process.env.ADMIN_LOCAL_BYPASS = 'true';
  delete process.env.VERCEL_ENV;

  for (const host of ['localhost', 'localhost:3000', '127.0.0.1:5173', '[::1]:3000', '::1']) {
    assert.equal(isLocalAdminDevelopmentRequest(createRequest('GET', '', { host })), true, host);
  }

  for (const host of [
    'localhost.attacker.com', 'attacker-localhost.com', '127.0.0.1.attacker.com',
    '192.168.1.5:3000', '10.0.0.5', '172.16.0.5', 'example.com', 'project.vercel.app',
  ]) {
    assert.equal(isLocalAdminDevelopmentRequest(createRequest('GET', '', { host })), false, host);
  }

  for (const configuredValue of ['TRUE', '1', 'yes', 'on']) {
    process.env.ADMIN_LOCAL_BYPASS = configuredValue;
    assert.equal(isLocalAdminDevelopmentRequest(createRequest('GET', '', { host: 'localhost:3000' })), false, configuredValue);
  }

  process.env.ADMIN_LOCAL_BYPASS = 'true';
  assert.equal(isLocalAdminDevelopmentRequest(createRequest('GET', '', {
    host: '192.168.1.5:3000',
    'x-forwarded-host': 'localhost:3000',
  })), false);

  process.env.ADMIN_LOCAL_BYPASS = 'false';
  assert.equal(isLocalAdminDevelopmentRequest(createRequest('GET', '', { host: 'localhost:3000' })), false);
  delete process.env.ADMIN_LOCAL_BYPASS;
  assert.equal(isLocalAdminDevelopmentRequest(createRequest('GET', '', { host: 'localhost:3000' })), false);

  process.env.ADMIN_LOCAL_BYPASS = 'true';
  process.env.VERCEL_ENV = 'preview';
  assert.equal(isLocalAdminDevelopmentRequest(createRequest('GET', '', { host: 'localhost:3000' })), false);
  process.env.VERCEL_ENV = 'production';
  assert.equal(isLocalAdminDevelopmentRequest(createRequest('GET', '', { host: 'localhost:3000' })), false);
  delete process.env.VERCEL_ENV;
  process.env.NODE_ENV = 'production';
  assert.equal(isLocalAdminDevelopmentRequest(createRequest('GET', '', { host: 'localhost:3000' })), false);
});

test('localhost session endpoint succeeds without PAT, cookie, or GitHub request', async () => {
  process.env.NODE_ENV = 'development';
  process.env.ADMIN_LOCAL_BYPASS = 'true';
  delete process.env.VERCEL_ENV;
  delete process.env.GITHUB_PAT;
  delete process.env.ADMIN_SESSION_SECRET;
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD_HASH;

  let githubRequestCount = 0;
  globalThis.fetch = (async () => {
    githubRequestCount += 1;
    throw new Error('Session endpoint must not contact GitHub.');
  }) as typeof fetch;

  const response = createResponse();
  await sessionHandler(createRequest('GET', '', { host: 'localhost:3000' }), response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, {
    success: true,
    authenticated: true,
    developmentBypass: true,
    mode: 'local-development',
  });
  assert.equal(response.headers.has('set-cookie'), false);
  assert.equal(githubRequestCount, 0);

  const context = getAdminAuthContext(createRequest('GET', '', { host: '[::1]:5173' }), createResponse());
  assert.deepEqual(context, {
    mode: 'local-development',
    authenticated: true,
    admin: true,
    developmentBypass: true,
    identity: 'local-development-admin',
  });
});

test('session endpoint remains protected on LAN, Preview, and Production even when bypass is true', async () => {
  process.env.ADMIN_LOCAL_BYPASS = 'true';
  const deniedHosts: Array<{ environment: string; vercel?: string; host: string }> = [
    { environment: 'development', host: '192.168.1.10:3000' },
    { environment: 'development', vercel: 'preview', host: 'localhost:3000' },
    { environment: 'production', host: 'localhost:3000' },
    { environment: 'production', vercel: 'production', host: 'localhost:3000' },
  ];

  for (const { environment, vercel, host } of deniedHosts) {
    process.env.NODE_ENV = environment;
    if (vercel) process.env.VERCEL_ENV = vercel;
    else delete process.env.VERCEL_ENV;
    const response = createResponse();
    await sessionHandler(createRequest('GET', '', { host }), response);
    assert.equal(response.statusCode, 401, `${environment}/${vercel ?? 'local'} ${host}`);
    assert.deepEqual(response.payload, {
      success: false,
      authenticated: false,
      developmentBypass: false,
      mode: 'unauthenticated',
    });
  }
});

test('localhost bypass authorizes real GitHub status and data reads without a browser session cookie', async () => {
  process.env.NODE_ENV = 'development';
  process.env.ADMIN_LOCAL_BYPASS = 'true';
  delete process.env.VERCEL_ENV;
  const requests = successfulGithubMock();

  const statusResponse = createResponse();
  await statusHandler(createRequest('GET', '', { host: '127.0.0.1:3000' }), statusResponse);
  assert.equal(statusResponse.statusCode, 200);
  assert.deepEqual(statusResponse.payload, {
    success: true,
    connected: true,
    repository: 'test-owner/academic-archive',
    branch: 'main',
    dataPath: 'public/data/data.json',
  });

  const dataResponse = createResponse();
  await dataHandler(createRequest('GET', '', { host: '[::1]:3000' }), dataResponse);
  assert.equal(dataResponse.statusCode, 200);
  assert.deepEqual(dataResponse.payload, {
    success: true,
    data: archive,
    sha: 'a'.repeat(40),
    path: 'public/data/data.json',
    branch: 'main',
  });

  assert.equal(requests.length, 2);
  assert.ok(requests.every(({ headers }) => headers.get('authorization') === `Bearer ${process.env.GITHUB_PAT}`));
});

test('localhost Admin remains available without PAT while GitHub operations fail with a safe configuration error', async () => {
  process.env.NODE_ENV = 'development';
  process.env.ADMIN_LOCAL_BYPASS = 'true';
  delete process.env.VERCEL_ENV;
  delete process.env.GITHUB_PAT;
  delete process.env.ADMIN_SESSION_SECRET;
  delete process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD_HASH;

  const sessionResponse = createResponse();
  await sessionHandler(createRequest('GET', '', { host: 'localhost:3000' }), sessionResponse);
  assert.deepEqual(sessionResponse.payload, {
    success: true,
    authenticated: true,
    developmentBypass: true,
    mode: 'local-development',
  });

  const statusResponse = createResponse();
  await statusHandler(createRequest('GET', '', { host: 'localhost:3000' }), statusResponse);
  assert.equal(statusResponse.statusCode, 503);
  assert.deepEqual(statusResponse.payload, {
    success: false,
    error: 'GITHUB_CREDENTIALS_NOT_CONFIGURED',
    message: 'GitHub credentials are not configured for local development.',
  });

  const dataResponse = createResponse();
  await dataHandler(createRequest('GET', '', { host: 'localhost:3000' }), dataResponse);
  assert.equal(dataResponse.statusCode, 503);
  assert.deepEqual(dataResponse.payload, statusResponse.payload);
});

test('encrypted session cookie protects only safe identity, expires, and rejects tampering', () => {
  const config = getServerConfig();
  const response = createResponse();
  createSessionCookie(response, { ...config, secureCookies: true }, 'test-admin@example.test');
  const setCookie = response.headers.get('set-cookie');
  assert.equal(typeof setCookie, 'string');
  assert.match(setCookie as string, /HttpOnly/);
  assert.match(setCookie as string, /Secure/);
  assert.match(setCookie as string, /SameSite=Strict/);
  assert.match(setCookie as string, /Path=\/api/);
  assert.match(setCookie as string, /Max-Age=28800/);
  assert.equal(SESSION_TTL_SECONDS, 8 * 60 * 60);
  assert.equal((setCookie as string).includes(config.githubPat), false);

  const cookie = cookieFrom(response);
  const request = createRequest('GET', '', { cookie });
  assert.equal(readAdminSession(request, config)?.adminEmail, TEST_ADMIN_EMAIL);

  const token = cookie.slice(`${SESSION_COOKIE_NAME}=`.length);
  const [iv, ciphertext, tag] = token.split('.');
  assert.ok(iv && ciphertext && tag);
  const changedCiphertext = `${ciphertext[0] === 'A' ? 'B' : 'A'}${ciphertext.slice(1)}`;
  const tampered = createRequest('GET', '', { cookie: `${SESSION_COOKIE_NAME}=${iv}.${changedCiphertext}.${tag}` });
  assert.equal(readAdminSession(tampered, config), null);
});

test('email/password login validates the server PAT and creates an encrypted session without returning credentials', async () => {
  const requests = successfulGithubMock();
  const pat = process.env.GITHUB_PAT;
  assert.ok(pat);
  const request = createRequest('POST', JSON.stringify({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }));
  const response = createResponse();
  await loginHandler(request, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, { success: true, authenticated: true, adminEmail: TEST_ADMIN_EMAIL });
  assert.equal(requests.length, 3);
  assert.ok(requests.every(({ headers }) => headers.get('authorization') === `Bearer ${pat}`));
  assert.ok(requests.every(({ body }) => !(body ?? '').includes(TEST_ADMIN_PASSWORD)));
  assert.equal(JSON.stringify(response.payload).includes(TEST_ADMIN_PASSWORD), false);
  assert.equal(JSON.stringify(response.payload).includes(TEST_ADMIN_PASSWORD_HASH), false);
  assert.equal(JSON.stringify(response.payload).includes(pat), false);
  assert.match(String(response.headers.get('set-cookie')), /HttpOnly/);
  assert.equal(String(response.headers.get('set-cookie')).includes(pat), false);
  assert.equal(String(response.headers.get('set-cookie')).includes(TEST_ADMIN_PASSWORD), false);

  const sessionResponse = createResponse();
  await sessionHandler(createRequest('GET', '', { cookie: cookieFrom(response) }), sessionResponse);
  assert.deepEqual(sessionResponse.payload, {
    success: true,
    authenticated: true,
    developmentBypass: false,
    mode: 'authenticated-session',
    adminEmail: TEST_ADMIN_EMAIL,
    repository: 'test-owner/academic-archive',
  });
});

test('login rejects invalid email/password without calling GitHub', async () => {
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    throw new Error('Invalid credentials must not call GitHub.');
  }) as typeof fetch;

  const mismatchResponse = createResponse();
  await loginHandler(createRequest('POST', JSON.stringify({ email: TEST_ADMIN_EMAIL, password: 'wrong password' })), mismatchResponse);
  assert.equal(mismatchResponse.statusCode, 401);
  assert.equal(requestCount, 0);
  assert.deepEqual(mismatchResponse.payload, { success: false, error: 'AUTHENTICATION_FAILED', message: 'Email or password is incorrect.' });

  const deniedResponse = createResponse();
  await loginHandler(createRequest('POST', JSON.stringify({ email: 'other@example.test', password: TEST_ADMIN_PASSWORD })), deniedResponse);
  assert.equal(deniedResponse.statusCode, 401);
  assert.equal(requestCount, 0);
  assert.equal(deniedResponse.headers.has('set-cookie'), false);

  let githubRequestCount = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    githubRequestCount += 1;
    const url = input instanceof Request ? input.url : String(input);
    return url.endsWith('/user')
      ? new Response(JSON.stringify({ login: 'server-token-user' }), { status: 200 })
      : new Response(JSON.stringify({ permissions: { push: false } }), { status: 200 });
  }) as typeof fetch;
  const permissionDeniedResponse = createResponse();
  await loginHandler(createRequest('POST', JSON.stringify({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD })), permissionDeniedResponse);
  assert.equal(permissionDeniedResponse.statusCode, 403);
  assert.equal(githubRequestCount, 2);
  assert.equal(permissionDeniedResponse.headers.has('set-cookie'), false);
});

test('login rejects PAT-only and mixed credential payloads without reflecting the PAT', async () => {
  const pat = process.env.GITHUB_PAT;
  assert.ok(pat);
  const patOnlyResponse = createResponse();
  await loginHandler(createRequest('POST', JSON.stringify({ pat })), patOnlyResponse);
  assert.equal(patOnlyResponse.statusCode, 400);
  assert.equal(JSON.stringify(patOnlyResponse.payload).includes(pat), false);

  const mixedResponse = createResponse();
  await loginHandler(createRequest('POST', JSON.stringify({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD, pat })), mixedResponse);
  assert.equal(mixedResponse.statusCode, 400);
  assert.equal(JSON.stringify(mixedResponse.payload).includes(pat), false);
});

test('login rejects malformed JSON and unsupported content types without reflecting submitted data', async () => {
  const malformedResponse = createResponse();
  await loginHandler(createRequest('POST', '{'), malformedResponse);
  assert.equal(malformedResponse.statusCode, 400);
  assert.deepEqual(malformedResponse.payload, {
    success: false,
    error: 'INVALID_JSON',
    message: 'The request body must contain valid JSON.',
  });

  const unsupportedResponse = createResponse();
  await loginHandler(createRequest('POST', JSON.stringify({ email: TEST_ADMIN_EMAIL, password: 'not-a-secret' }), { 'content-type': 'text/plain' }), unsupportedResponse);
  assert.equal(unsupportedResponse.statusCode, 415);
  assert.equal(JSON.stringify(unsupportedResponse.payload).includes('not-a-secret'), false);
});

test('JSON body reader accepts Vercel-parsed bodies and enforces the size limit', async () => {
  const parsedBody = { data: { site: { name: 'Portfolio' } } };
  const parsedRequest = Object.assign(createRequest('PUT'), { body: parsedBody });
  assert.deepEqual(await readJsonBody(parsedRequest), parsedBody);

  const rawRequest = createRequest('PUT', '{"ready":true}');
  assert.deepEqual(await readJsonBody(rawRequest), { ready: true });

  const oversizedRequest = Object.assign(createRequest('PUT'), { body: { value: 'too large' } });
  await assert.rejects(
    readJsonBody(oversizedRequest, 5),
    (error: unknown) => error instanceof ApiError && error.status === 413,
  );
});

test('session and data routes reject unauthenticated requests and clear expired cookies', async () => {
  const sessionResponse = createResponse();
  await sessionHandler(createRequest('GET'), sessionResponse);
  assert.equal(sessionResponse.statusCode, 401);
  assert.deepEqual(sessionResponse.payload, {
    success: false,
    authenticated: false,
    developmentBypass: false,
    mode: 'unauthenticated',
  });
  assert.match(String(sessionResponse.headers.get('set-cookie')), /Max-Age=0/);

  const dataResponse = createResponse();
  await dataHandler(createRequest('GET'), dataResponse);
  assert.equal(dataResponse.statusCode, 401);
});

test('logout rejects cross-origin requests and clears the same-origin session cookie', async () => {
  const crossOriginResponse = createResponse();
  await logoutHandler(createRequest('POST', '', { origin: 'https://attacker.test' }), crossOriginResponse);
  assert.equal(crossOriginResponse.statusCode, 403);
  assert.equal(crossOriginResponse.headers.has('set-cookie'), false);

  const logoutResponse = createResponse();
  await logoutHandler(createRequest('POST'), logoutResponse);
  assert.equal(logoutResponse.statusCode, 200);
  assert.deepEqual(logoutResponse.payload, { success: true, authenticated: false });
  assert.match(String(logoutResponse.headers.get('set-cookie')), /Max-Age=0/);
});

test('GitHub status reports only configured safe metadata and requires a valid session', async () => {
  const requests = successfulGithubMock();
  const response = createResponse();
  await statusHandler(createRequest('GET', '', { cookie: createAuthenticatedCookie() }), response);
  assert.deepEqual(response.payload, {
    success: true,
    connected: true,
    repository: 'test-owner/academic-archive',
    branch: 'main',
    dataPath: 'public/data/data.json',
  });
  assert.equal(requests.length, 1);
  assert.equal(JSON.stringify(response.payload).includes(process.env.GITHUB_PAT ?? ''), false);
  assert.equal(response.headers.get('cache-control'), 'no-store, private');
});

test('revoked GitHub credentials invalidate an otherwise valid admin session', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ message: 'sensitive upstream detail' }), { status: 401 })) as typeof fetch;
  const response = createResponse();
  const diagnostics: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...values: unknown[]) => { diagnostics.push(values.join(' ')); };
  try {
    await statusHandler(createRequest('GET', '', { cookie: createAuthenticatedCookie() }), response);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.payload, {
    success: false,
    error: 'GITHUB_AUTH_FAILED',
    message: 'GitHub authentication failed.',
  });
  assert.match(String(response.headers.get('set-cookie')), /Max-Age=0/);
  assert.equal(JSON.stringify(response.payload).includes('sensitive upstream detail'), false);
  assert.doesNotMatch(diagnostics.join('\n'), /sensitive upstream detail/);
  assert.match(diagnostics.join('\n'), /"status":401/);
});

test('data read decodes and validates the file but omits raw GitHub metadata', async () => {
  const requests = successfulGithubMock();
  const response = createResponse();
  await dataHandler(createRequest('GET', '', { cookie: createAuthenticatedCookie() }), response);
  assert.deepEqual(response.payload, {
    success: true,
    data: archive,
    sha: 'a'.repeat(40),
    path: 'public/data/data.json',
    branch: 'main',
  });
  assert.equal(requests.length, 1);
  assert.equal(JSON.stringify(response.payload).includes('download_url'), false);
});

test('data read rejects GitHub content that exceeds the configured archive size limit', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    encoding: 'base64',
    content: 'A'.repeat(Math.ceil(ARCHIVE_MAX_BYTES / 3) * 4 + 4),
    sha: 'a'.repeat(40),
  }), { status: 200 })) as typeof fetch;

  await assert.rejects(
    getGithubData(getServerConfig()),
    (error: unknown) => error instanceof ApiError && error.status === 413,
  );
});

test('data write uses only configured path and branch and returns safe SHA metadata', async () => {
  const requests: Array<{ url: string; headers: Headers; body?: string }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: input instanceof Request ? input.url : String(input),
      headers: new Headers(init?.headers),
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    });
    if (!init?.method || init.method === 'GET') return githubFileResponse('a'.repeat(40));
    return new Response(JSON.stringify({
      content: { sha: 'b'.repeat(40), path: '.env' },
      commit: { sha: 'c'.repeat(40), html_url: 'https://example.invalid/private' },
    }), { status: 200 });
  }) as typeof fetch;

  const update = { data: completeProfileArchive, sha: 'a'.repeat(40), message: 'Update archive' };
  const response = createResponse();
  await dataHandler(createRequest('PUT', JSON.stringify(update), { cookie: createAuthenticatedCookie() }), response);
  assert.equal(response.statusCode, 200);
  const { data: savedData, links, ...updateResult } = response.payload as { data: AcademicArchive; links: Array<{ id: string; token: string }>; success: true; contentSha: string; commitSha: string };
  assert.deepEqual(updateResult, {
    success: true,
    contentSha: 'b'.repeat(40),
    commitSha: 'c'.repeat(40),
  });
  assert.deepEqual(links, []);
  assert.equal(requests.length, 2);
  assert.equal(requests[1]?.url, 'https://api.github.com/repos/test-owner/academic-archive/contents/public/data/data.json');
  assert.equal(requests[1]?.headers.get('authorization'), `Bearer ${process.env.GITHUB_PAT}`);
  assert.equal(requests[1]?.headers.get('x-github-api-version'), '2026-03-10');
  const sentBody = JSON.parse(requests[1]?.body ?? '{}') as Record<string, unknown>;
  assert.equal(sentBody.sha, update.sha);
  assert.equal(sentBody.branch, 'main');
  assert.equal(sentBody.message, update.message);
  assert.equal(sentBody.path, undefined);
  assert.equal(sentBody.content, Buffer.from(JSON.stringify(completeProfileArchive, null, 2), 'utf8').toString('base64'));
  assert.deepEqual(savedData, JSON.parse(Buffer.from(String(sentBody.content), 'base64').toString('utf8')));
});

test('data write preserves a safe GitHub Contents permission error', async () => {
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      return new Response(JSON.stringify({ message: 'Resource not accessible by personal access token' }), { status: 403 });
    }
    return githubFileResponse('a'.repeat(40));
  }) as typeof fetch;

  const response = createResponse();
  await dataHandler(createRequest('PUT', JSON.stringify({
    data: archive,
    sha: 'a'.repeat(40),
    message: 'Test rejected Contents write',
  }), { cookie: createAuthenticatedCookie() }), response);

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.payload, {
    success: false,
    error: 'GITHUB_ACCESS_DENIED',
    message: 'Resource not accessible by personal access token',
  });
  assert.equal(JSON.stringify(response.payload).includes(process.env.GITHUB_PAT ?? ''), false);
});

test('data writes reject arbitrary path, stale SHA, unsupported methods, and oversized bodies', async () => {
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    return new Response('', { status: 409 });
  }) as typeof fetch;
  const cookie = createAuthenticatedCookie();
  const invalidPathResponse = createResponse();
  await dataHandler(createRequest('PUT', JSON.stringify({
    data: archive,
    sha: 'a'.repeat(40),
    path: '.env',
  }), { cookie }), invalidPathResponse);
  assert.equal(invalidPathResponse.statusCode, 400);
  assert.equal(requestCount, 0);

  const conflictResponse = createResponse();
  await dataHandler(createRequest('PUT', JSON.stringify({ data: completeProfileArchive, sha: 'a'.repeat(40) }), { cookie }), conflictResponse);
  assert.equal(conflictResponse.statusCode, 409);
  assert.deepEqual(conflictResponse.payload, {
    success: false,
    error: 'GITHUB_CONFLICT',
    message: 'The academic data changed on GitHub. Reload the current data before saving again.',
  });
  assert.equal(requestCount, 1);

  const methodResponse = createResponse();
  await dataHandler(createRequest('POST'), methodResponse);
  assert.equal(methodResponse.statusCode, 405);

  const oversizedRequest = createRequest('PUT', '', {
    cookie,
    'content-type': 'application/json',
    'content-length': String(MAX_DATA_BODY_BYTES + 1),
  });
  const oversizedResponse = createResponse();
  await dataHandler(oversizedRequest, oversizedResponse);
  assert.equal(oversizedResponse.statusCode, 413);
});

test('data write rejects an incomplete changed profile before performing a GitHub write', async () => {
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    return new Response(JSON.stringify({
      encoding: 'base64',
      content: Buffer.from(JSON.stringify(completeProfileArchive), 'utf8').toString('base64'),
      sha: 'a'.repeat(40),
    }), { status: 200 });
  }) as typeof fetch;

  const response = createResponse();
  await dataHandler(createRequest('PUT', JSON.stringify({
    data: archive,
    sha: 'a'.repeat(40),
  }), { cookie: createAuthenticatedCookie() }), response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.payload, {
    success: false,
    error: 'PROFILE_VALIDATION_FAILED',
    message: 'Academic profile does not match the required fields.',
  });
  assert.equal(requestCount, 1);
});

test('Vercel Preview never allows the local bypass and always uses Secure session cookies', () => {
  process.env.NODE_ENV = 'development';
  process.env.VERCEL_ENV = 'preview';
  process.env.ADMIN_LOCAL_BYPASS = 'true';
  assert.equal(isLocalAdminDevelopmentRequest(createRequest('GET', '', { host: 'localhost:3000' })), false);
  assert.equal(isSecureDeployment(), true);

  const config = getServerConfig();
  assert.equal(config.secureCookies, true);
  const createResponseValue = createResponse();
  createSessionCookie(createResponseValue, config, TEST_ADMIN_EMAIL);
  assert.match(String(createResponseValue.headers.get('set-cookie')), /Secure/);

  const clearResponse = createResponse();
  expireCookieForEnvironment(clearResponse);
  assert.match(String(clearResponse.headers.get('set-cookie')), /Secure/);
});
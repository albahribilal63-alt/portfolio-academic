import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, test } from 'node:test';
import type { VercelRequest, VercelResponse } from '../api/_lib/platform.ts';
import { parseAcademicArchive } from '../api/_lib/archive-schema.ts';
import { getServerConfig } from '../api/_lib/config.ts';
import { ApiError } from '../api/_lib/errors.ts';
import { activeIsolatedTokenUrls, createIsolatedToken, decryptIsolatedToken, encryptIsolatedToken, ensurePrimaryProfessorLinks, hashIsolatedToken, repairUnreadableIsolatedLinkTokens, resolveIsolatedScope } from '../api/_lib/isolated-links.ts';
import { createSessionCookie } from '../api/_lib/session.ts';
import tokenHandler from '../api/admin/isolated-link-token.ts';
import dataHandler from '../api/admin/data.ts';
import assetHandler from '../api/isolated/asset.ts';
import feedbackHandler from '../api/isolated/feedback.ts';
import resolveHandler from '../api/isolated/resolve.ts';
import { ADMIN_ISOLATED_LINKS_ROUTE, ADMIN_ROUTE, ISOLATED_ASSESSMENT_ROUTE_PREFIX, isolatedAssessmentPath, isolatedAssessmentUrl, isolatedAssetPath, resolveApplicationMode } from '../src/app/routing.ts';
import type { AcademicArchive, IsolatedLink } from '../src/types/academic.ts';
import { deleteActivityCascade } from '../src/features/admin/activities/activities.ts';
import { deleteModuleCascade } from '../src/features/admin/modules/modules.ts';

const ENVIRONMENT_KEYS = ['GITHUB_PAT', 'GITHUB_OWNER', 'GITHUB_REPO', 'GITHUB_BRANCH', 'GITHUB_DATA_PATH', 'ADMIN_SESSION_SECRET', 'ADMIN_LOCAL_BYPASS', 'NODE_ENV', 'VERCEL_ENV'] as const;
const originalEnvironment = new Map<string, string | undefined>();
const originalFetch = globalThis.fetch;

interface CapturedResponse extends VercelResponse {
  statusCode: number;
  payload: unknown;
  body: Buffer | undefined;
  headers: Map<string, string | string[]>;
}

const moduleOne = { id: 'module-one', yearId: 'year-one', code: 'M1', name: 'Scoped Module', description: 'Visible module description', order: 1, visibility: 'private' as const };
const moduleTwo = { id: 'module-two', yearId: 'year-two', code: 'M2', name: 'Outside Module', order: 1, visibility: 'public' as const };
const activityOne = { id: 'activity-one', moduleId: moduleOne.id, title: 'Scoped Activity', description: 'Visible activity description', type: 'exercise' as const, order: 1, visibility: 'private' as const };
const activityTwo = { id: 'activity-two', moduleId: moduleOne.id, title: 'Other Activity', type: 'quiz' as const, order: 2, visibility: 'private' as const };
const outsideActivity = { id: 'activity-outside', moduleId: moduleTwo.id, title: 'Outside Activity', type: 'lab' as const, order: 1, visibility: 'public' as const };
const assetOne = { id: 'asset-one', activityId: activityOne.id, name: 'Scoped.pdf', type: 'PDF' as const, path: 'public/storage/docs/asset-one.pdf', order: 1, visibility: 'private' as const };
const assetTwo = { id: 'asset-two', activityId: activityTwo.id, name: 'Other.pdf', type: 'PDF' as const, path: 'public/storage/docs/asset-two.pdf', order: 1, visibility: 'private' as const };
const outsideAsset = { id: 'asset-outside', activityId: outsideActivity.id, name: 'Outside.pdf', type: 'PDF' as const, path: 'public/storage/docs/asset-outside.pdf', order: 1, visibility: 'public' as const };

function makeLink(overrides: Partial<IsolatedLink> = {}): IsolatedLink {
  const { tokenHash } = createIsolatedToken();
  return {
    id: 'link-one',
    tokenHash,
    tokenCiphertext: `v1.${'A'.repeat(16)}.${'A'.repeat(22)}.${'A'.repeat(58)}`,
    scopeType: 'module',
    scopeId: moduleOne.id,
    status: 'active',
    expiresAt: null,
    ...overrides,
  };
}

const archive = {
  site: { title: 'Academic Portal', description: 'Scoped academic resources' },
  profile: {
    lastName: 'ELBAHRI',
    firstName: 'Bilal',
    filiere: 'IAP3',
    section: 'Section I',
    tdGroup: 'Gr_01',
    name: 'Professor Name',
    title: 'Professor',
    institution: 'Example Institution',
    program: 'Computer Science',
    branch: 'Networks',
    semester: 'S3',
    cne: 'PRIVATE-CNE-DO-NOT-LEAK',
    apogee: 'PRIVATE-APOGEE-DO-NOT-LEAK',
    biography: 'PRIVATE-BIOGRAPHY-DO-NOT-LEAK',
  },
  years: [
    { id: 'year-one', name: '2025/2026', status: 'current' as const, order: 1 },
    { id: 'year-two', name: '2026/2027', status: 'upcoming' as const, order: 2 },
  ],
  modules: [moduleOne, moduleTwo],
  activities: [activityOne, activityTwo, outsideActivity],
  assets: [assetOne, assetTwo, outsideAsset],
  isolatedLinks: [] as IsolatedLink[],
  feedback: { internal: 'ADMIN-FEEDBACK-DO-NOT-LEAK' },
  adminSettings: { repository: 'PRIVATE-REPOSITORY-DO-NOT-LEAK' },
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
  createSessionCookie(response, getServerConfig(), 'test-admin@example.test');
  return String(response.headers.get('set-cookie')).split(';', 1)[0]!;
}

function createRequest(method: string, body?: unknown, headers: Record<string, string> = {}, url = '/api/admin/isolated-link-token'): VercelRequest {
  const bodyText = body === undefined ? '' : JSON.stringify(body);
  return Object.assign(Readable.from(bodyText ? [Buffer.from(bodyText)] : []), {
    method,
    url,
    headers: {
      host: 'academic.test',
      origin: 'http://academic.test',
      ...(bodyText ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(bodyText)) } : {}),
      ...headers,
    },
  }) as unknown as VercelRequest;
}

function githubArchiveResponse(data: unknown = archive, sha = 'a'.repeat(40)) {
  return new Response(JSON.stringify({
    encoding: 'base64',
    content: Buffer.from(JSON.stringify(data), 'utf8').toString('base64'),
    sha,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
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

test('link tokens are unique high-entropy base64url values and only SHA-256 digests are persisted', () => {
  const issued = Array.from({ length: 32 }, () => createIsolatedToken());
  const tokens = new Set(issued.map(({ token }) => token));
  const hashes = new Set(issued.map(({ tokenHash }) => tokenHash));
  assert.equal(tokens.size, issued.length);
  assert.equal(hashes.size, issued.length);
  for (const { token, tokenHash } of issued) {
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.match(tokenHash, /^[a-f0-9]{64}$/);
    assert.notEqual(token, tokenHash);
  }
});

test('token ciphertext can only be recovered using the server session secret', () => {
  const token = createIsolatedToken().token;
  const encrypted = encryptIsolatedToken(getServerConfig(), token);
  assert.notEqual(encrypted, token);
  assert.match(encrypted, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{58}$/);
  assert.equal(decryptIsolatedToken(getServerConfig(), encrypted), token);
  const wrongSecret = { ...getServerConfig(), adminSessionSecret: randomBytes(48).toString('base64url') };
  assert.equal(decryptIsolatedToken(wrongSecret, encrypted), undefined);
});

test('share URL builder uses the exact route parsed by the application', () => {
  const token = createIsolatedToken().token;
  assert.equal(ISOLATED_ASSESSMENT_ROUTE_PREFIX, '/assessment');
  assert.equal(isolatedAssessmentPath(token), `/assessment/${token}`);
  assert.equal(isolatedAssessmentUrl(token, 'https://portfolio.example'), `https://portfolio.example/assessment/${token}`);
  assert.throws(() => isolatedAssessmentPath('not-a-token'));
  assert.equal(resolveApplicationMode(isolatedAssessmentPath(token), ''), 'isolated');
});

test('isolated asset URLs carry only the scoped token and asset identifier', () => {
  const token = createIsolatedToken().token;
  const path = isolatedAssetPath(token, 'asset-one');
  assert.equal(path, `/api/isolated/asset?token=${token}&assetId=asset-one`);
  assert.throws(() => isolatedAssetPath('invalid', 'asset-one'));
  assert.throws(() => isolatedAssetPath(token, '../../asset-one'));
});

test('isolated file endpoint serves GitHub bytes only for assets inside the token scope', async () => {
  const issued = createIsolatedToken();
  const link = makeLink({
    scopeType: 'activity',
    scopeId: activityOne.id,
    tokenHash: issued.tokenHash,
    tokenCiphertext: encryptIsolatedToken(getServerConfig(), issued.token),
  });
  const otherFileAssets = [
    { id: 'asset-docx', activityId: activityOne.id, name: 'Scoped.docx', type: 'DOCX' as const, path: 'public/storage/docs/asset-docx.docx', order: 2, visibility: 'private' as const },
    { id: 'asset-xlsx', activityId: activityOne.id, name: 'Scoped.xlsx', type: 'XLSX' as const, path: 'public/storage/docs/asset-xlsx.xlsx', order: 3, visibility: 'private' as const },
    { id: 'asset-zip', activityId: activityOne.id, name: 'Scoped.zip', type: 'ZIP' as const, path: 'public/storage/docs/asset-zip.zip', order: 4, visibility: 'private' as const },
    { id: 'asset-code', activityId: activityOne.id, name: 'solution.js', type: 'CODE' as const, path: 'public/storage/docs/asset-code.code', order: 5, visibility: 'private' as const },
  ];
  const scopedArchive = { ...archive, assets: [...archive.assets, ...otherFileAssets], isolatedLinks: [link] };
  const pdfBytes = Buffer.from('%PDF-1.7\nscoped test PDF');
  const githubRequests: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const requestUrl = String(input);
    githubRequests.push(requestUrl);
    if (requestUrl.includes('/contents/public/data/data.json?')) return githubArchiveResponse(scopedArchive);
    if (requestUrl.includes('/contents/public/storage/docs/')) {
      const bytes = requestUrl.includes('.code?') ? Buffer.from('const answer = 42;\n') : pdfBytes;
      return new Response(JSON.stringify({
        encoding: 'base64',
        content: bytes.toString('base64'),
        sha: 'b'.repeat(40),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('Unexpected GitHub request.');
  }) as typeof fetch;

  const fileResponse = createResponse();
  await assetHandler(createRequest('GET', undefined, {}, isolatedAssetPath(issued.token, assetOne.id)), fileResponse);
  assert.equal(fileResponse.statusCode, 200);
  assert.equal(fileResponse.headers.get('content-type'), 'application/pdf');
  assert.equal(fileResponse.headers.get('content-disposition'), 'inline');
  assert.equal(fileResponse.headers.get('cache-control'), 'private, no-store');
  assert.equal(fileResponse.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(fileResponse.body, pdfBytes);
  assert.equal(fileResponse.body?.subarray(0, 4).toString('ascii'), '%PDF');
  assert.equal(JSON.stringify(fileResponse.headers).includes(process.env.GITHUB_PAT!), false);
  assert.equal(githubRequests.some((url) => url.includes(assetOne.path)), true);

  const expectedTypes = new Map([
    ['asset-docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'attachment']],
    ['asset-xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'attachment']],
    ['asset-zip', ['application/zip', 'attachment']],
    ['asset-code', ['text/plain; charset=utf-8', 'inline']],
  ]);
  for (const [assetId, [contentType, disposition]] of expectedTypes) {
    const otherFileResponse = createResponse();
    await assetHandler(createRequest('GET', undefined, {}, isolatedAssetPath(issued.token, assetId)), otherFileResponse);
    assert.equal(otherFileResponse.statusCode, 200);
    assert.equal(otherFileResponse.headers.get('content-type'), contentType);
    assert.equal(otherFileResponse.headers.get('content-disposition'), disposition);
    if (assetId === 'asset-code') assert.equal(otherFileResponse.body?.toString('utf8'), 'const answer = 42;\n');
  }

  const wrongScopeResponse = createResponse();
  await assetHandler(createRequest('GET', undefined, {}, isolatedAssetPath(issued.token, outsideAsset.id)), wrongScopeResponse);
  assert.equal(wrongScopeResponse.statusCode, 404);
  assert.equal(githubRequests.some((url) => url.includes(outsideAsset.path)), false);

  const extraParameterResponse = createResponse();
  await assetHandler(createRequest('GET', undefined, {}, `${isolatedAssetPath(issued.token, assetOne.id)}&path=${encodeURIComponent(outsideAsset.path)}`), extraParameterResponse);
  assert.equal(extraParameterResponse.statusCode, 404);
  assert.equal(githubRequests.some((url) => url.includes(outsideAsset.path)), false);
});

test('module scope returns only its module, activities, and assets with minimal academic identity', () => {
  const link = makeLink();
  const issued = issuedTokenFor(link);
  const result = resolveIsolatedScope({ ...archive, isolatedLinks: [issued.link] }, issued.token.token);
  assert.equal(result.scopeType, 'module');
  assert.equal(result.module.id, moduleOne.id);
  assert.deepEqual(result.activities.map((activity) => activity.id), [activityOne.id, activityTwo.id]);
  assert.deepEqual(result.assets.map((asset) => asset.id), [assetOne.id, assetTwo.id]);
  assert.deepEqual(result.profile, {
    lastName: 'ELBAHRI',
    firstName: 'Bilal',
    filiere: 'IAP3',
    section: 'Section I',
    tdGroup: 'Gr_01',
  });
  assert.equal(JSON.stringify(result).includes('isolatedLinks'), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE-CNE-DO-NOT-LEAK'), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE-APOGEE-DO-NOT-LEAK'), false);
  assert.equal(result.profile?.filiere, 'IAP3');
  assert.equal(JSON.stringify(result).includes('PRIVATE-BIOGRAPHY-DO-NOT-LEAK'), false);
  assert.equal(JSON.stringify(result).includes('ADMIN-FEEDBACK-DO-NOT-LEAK'), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE-REPOSITORY-DO-NOT-LEAK'), false);
  assert.equal(JSON.stringify(result).includes(moduleTwo.id), false);
  assert.equal(JSON.stringify(result).includes(outsideActivity.id), false);
  assert.equal(JSON.stringify(result).includes(outsideAsset.id), false);
});

test('scoped manifest includes only matching feedback and omits server asset paths', () => {
  const issued = issuedTokenFor(makeLink());
  const otherLink = makeLink({ id: 'other-link', scopeType: 'module', scopeId: moduleTwo.id });
  const scopedFeedback = {
    isolatedLinkId: issued.link.id,
    activityId: activityOne.id,
    professorName: 'Dr Scoped',
    score: 18,
    comments: 'Scoped comment',
    observations: 'Scoped observation',
    submittedAt: '2026-01-01T00:00:00.000Z',
  };
  const otherFeedback = { ...scopedFeedback, isolatedLinkId: otherLink.id, activityId: outsideActivity.id, comments: 'OUTSIDE-FEEDBACK-DO-NOT-LEAK' };
  const result = resolveIsolatedScope({
    ...archive,
    isolatedLinks: [issued.link, otherLink],
    professorFeedback: [scopedFeedback, otherFeedback],
  }, issued.token.token);

  assert.deepEqual(result.feedbackByActivity[activityOne.id], {
    professorName: scopedFeedback.professorName,
    score: scopedFeedback.score,
    comments: scopedFeedback.comments,
    observations: scopedFeedback.observations,
    submittedAt: scopedFeedback.submittedAt,
  });
  assert.equal(result.feedbackByActivity[activityTwo.id], null);
  assert.equal(JSON.stringify(result).includes('OUTSIDE-FEEDBACK-DO-NOT-LEAK'), false);
  assert.equal('path' in result.assets[0]!, false);
});

test('activity scope returns only its activity and assets plus its parent module context', () => {
  const token = createIsolatedToken();
  const link = makeLink({ scopeType: 'activity', scopeId: activityOne.id, tokenHash: token.tokenHash });
  const result = resolveIsolatedScope({ ...archive, isolatedLinks: [link] }, token.token);
  assert.equal(result.scopeType, 'activity');
  assert.equal(result.module.id, moduleOne.id);
  assert.deepEqual(result.activities.map((activity) => activity.id), [activityOne.id]);
  assert.deepEqual(result.assets.map((asset) => asset.id), [assetOne.id]);
  assert.equal(JSON.stringify(result).includes(activityTwo.id), false);
  assert.equal(JSON.stringify(result).includes(assetTwo.id), false);
  assert.equal(JSON.stringify(result).includes(moduleTwo.id), false);
});

test('primary link provisioning is idempotent, stable across edits, and preserves legacy links', () => {
  const legacyToken = createIsolatedToken();
  const legacyLink = makeLink({ id: 'legacy-module-link', tokenHash: legacyToken.tokenHash, scopeId: moduleOne.id });
  const source = { ...archive, isolatedLinks: [legacyLink] };
  const first = ensurePrimaryProfessorLinks(source, source, getServerConfig());
  const primaryLinks = first.data.isolatedLinks!.filter((link) => link.purpose === 'primary-professor');
  assert.equal(first.changed, true);
  assert.equal(primaryLinks.length, 5);
  assert.equal(first.data.isolatedLinks?.some((link) => link.id === legacyLink.id), true);
  assert.equal(JSON.stringify(first.data).includes(first.createdTokens[0]!.token), false);

  const repeated = ensurePrimaryProfessorLinks(first.data, first.data, getServerConfig());
  assert.equal(repeated.changed, false);
  assert.deepEqual(repeated.data.isolatedLinks, first.data.isolatedLinks);

  const renamed = {
    ...first.data,
    modules: first.data.modules?.map((module) => module.id === moduleOne.id ? { ...module, name: 'Renamed Module' } : module),
    activities: first.data.activities?.map((activity) => activity.id === activityOne.id ? { ...activity, title: 'Renamed Activity' } : activity),
  };
  const edited = ensurePrimaryProfessorLinks(renamed, first.data, getServerConfig());
  assert.equal(edited.createdTokens.length, 0);
  assert.deepEqual(
    edited.data.isolatedLinks?.filter((link) => link.purpose === 'primary-professor').map(({ id, tokenHash, tokenCiphertext }) => ({ id, tokenHash, tokenCiphertext })),
    primaryLinks.map(({ id, tokenHash, tokenCiphertext }) => ({ id, tokenHash, tokenCiphertext })),
  );
});

test('unreadable active isolated tokens are reissued under the current key without changing their scopes', () => {
  const currentConfig = getServerConfig();
  const oldConfig = { ...currentConfig, adminSessionSecret: randomBytes(48).toString('base64url') };
  const oldToken = createIsolatedToken();
  const activeLink = makeLink({
    id: 'rotated-key-link',
    scopeType: 'activity',
    scopeId: activityOne.id,
    tokenHash: oldToken.tokenHash,
    tokenCiphertext: encryptIsolatedToken(oldConfig, oldToken.token),
    purpose: 'primary-professor',
    expiresAt: null,
  });
  const revokedLink = makeLink({ id: 'revoked-link', status: 'revoked' });
  const source = { ...archive, isolatedLinks: [activeLink, revokedLink] };

  const repaired = repairUnreadableIsolatedLinkTokens(source, currentConfig);
  const repairedActive = repaired.data.isolatedLinks!.find((link) => link.id === activeLink.id)!;
  const repairedRevoked = repaired.data.isolatedLinks!.find((link) => link.id === revokedLink.id)!;
  const urls = activeIsolatedTokenUrls(repaired.data.isolatedLinks!, currentConfig);

  assert.equal(repaired.changed, true);
  assert.equal(repaired.issuedTokens.length, 1);
  assert.equal(repairedActive.scopeType, activeLink.scopeType);
  assert.equal(repairedActive.scopeId, activeLink.scopeId);
  assert.equal(repairedActive.status, activeLink.status);
  assert.equal(repairedActive.expiresAt, activeLink.expiresAt);
  assert.equal(repairedActive.purpose, activeLink.purpose);
  assert.notEqual(repairedActive.tokenHash, activeLink.tokenHash);
  assert.equal(repairedRevoked.tokenHash, revokedLink.tokenHash);
  assert.equal(decryptIsolatedToken(currentConfig, repairedActive.tokenCiphertext), repaired.issuedTokens[0]!.token);
  assert.deepEqual(urls, repaired.issuedTokens);
  assert.equal(JSON.stringify(repaired.data).includes(repaired.issuedTokens[0]!.token), false);

  const repeated = repairUnreadableIsolatedLinkTokens(repaired.data, currentConfig);
  assert.equal(repeated.changed, false);
  assert.deepEqual(repeated.issuedTokens, []);
});

test('Module and Activity lifecycle writes provision, preserve, revoke, reactivate, and remove primary links', async () => {
  const legacyToken = createIsolatedToken();
  const legacyLink = makeLink({ id: 'legacy-manual-link', scopeId: moduleOne.id, tokenHash: legacyToken.tokenHash });
  let savedData: AcademicArchive = {
    site: archive.site,
    profile: archive.profile,
    years: archive.years,
    modules: [moduleOne],
    activities: [],
    assets: [],
    isolatedLinks: [legacyLink],
    professorFeedback: [],
  };
  let currentSha = 'a'.repeat(40);
  let writes = 0;
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!url.pathname.endsWith('/contents/public/data/data.json')) throw new Error('Unexpected GitHub request.');
    if (init.method?.toUpperCase() === 'PUT') {
      const body = JSON.parse(String(init.body)) as { content: string; sha: string };
      assert.equal(body.sha, currentSha);
      savedData = JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')) as AcademicArchive;
      currentSha = (++writes).toString(16).padStart(40, '0');
      return new Response(JSON.stringify({ content: { sha: currentSha }, commit: { sha: 'f'.repeat(40) } }), { status: 200 });
    }
    return githubArchiveResponse(savedData, currentSha);
  }) as typeof fetch;

  async function save(data: AcademicArchive) {
    const response = createResponse();
    await dataHandler(createRequest('PUT', { data, sha: currentSha }, { cookie: adminCookie() }), response);
    assert.equal(response.statusCode, 200, JSON.stringify(response.payload));
    return response;
  }

  async function resolve(token: string) {
    const response = createResponse();
    await resolveHandler(createRequest('GET', undefined, {}, `/api/isolated/resolve?token=${encodeURIComponent(token)}`), response);
    return response;
  }

  const created = { ...savedData, modules: [moduleOne, moduleTwo], activities: [activityOne, outsideActivity] };
  const createResponseResult = await save(created);
  assert.equal((createResponseResult.payload as { success: boolean }).success, true);
  let createdLinks = (savedData.isolatedLinks ?? []).filter((link) => link.purpose === 'primary-professor');
  assert.deepEqual(createdLinks.map(({ scopeType, scopeId }) => `${scopeType}:${scopeId}`).sort(), [
    `activity:${activityOne.id}`,
    `activity:${outsideActivity.id}`,
    `module:${moduleTwo.id}`,
  ].sort());
  assert.equal(JSON.stringify(savedData).includes(process.env.GITHUB_PAT!), false);

  const migrationResponse = createResponse();
  await tokenHandler(createRequest('POST', { action: 'provision-primary-links' }, { cookie: adminCookie() }), migrationResponse);
  assert.equal(migrationResponse.statusCode, 200, JSON.stringify(migrationResponse.payload));
  const migration = migrationResponse.payload as { data: typeof savedData; sha: string; links: Array<{ id: string; token: string }> };
  savedData = migration.data;
  currentSha = migration.sha;
  createdLinks = (savedData.isolatedLinks ?? []).filter((link) => link.purpose === 'primary-professor');
  assert.equal(createdLinks.length, 4);
  assert.equal(savedData.isolatedLinks?.some((link) => link.id === legacyLink.id), true);
  const repairedLegacyToken = migration.links.find(({ id }) => id === legacyLink.id)?.token;
  assert.ok(repairedLegacyToken);
  assert.equal(savedData.isolatedLinks?.find((link) => link.id === legacyLink.id)?.tokenHash, hashIsolatedToken(repairedLegacyToken));
  const repairedLegacyScope = await resolve(repairedLegacyToken);
  assert.equal(repairedLegacyScope.statusCode, 200);
  assert.equal((repairedLegacyScope.payload as { scope: { scopeId: string } }).scope.scopeId, moduleOne.id);
  assert.equal(JSON.stringify(savedData).includes(migration.links[0]!.token), false);
  assert.equal(JSON.stringify(migrationResponse.payload).includes(process.env.GITHUB_PAT!), false);

  const writesAfterMigration = writes;
  const repeatedMigration = createResponse();
  await tokenHandler(createRequest('POST', { action: 'provision-primary-links' }, { cookie: adminCookie() }), repeatedMigration);
  assert.equal(repeatedMigration.statusCode, 200);
  assert.equal(writes, writesAfterMigration);

  const primaryTokens = new Map(migration.links
    .filter(({ id }) => createdLinks.some((link) => link.id === id))
    .map(({ id, token }) => [id, token]));
  const moduleLink = createdLinks.find((link) => link.scopeType === 'module' && link.scopeId === moduleOne.id)!;
  const otherModuleLink = createdLinks.find((link) => link.scopeType === 'module' && link.scopeId === moduleTwo.id)!;
  const activityLink = createdLinks.find((link) => link.scopeType === 'activity' && link.scopeId === activityOne.id)!;
  const otherActivityLink = createdLinks.find((link) => link.scopeType === 'activity' && link.scopeId === outsideActivity.id)!;
  const moduleToken = primaryTokens.get(moduleLink.id)!;
  const otherModuleToken = primaryTokens.get(otherModuleLink.id)!;
  const activityToken = primaryTokens.get(activityLink.id)!;
  const otherActivityToken = primaryTokens.get(otherActivityLink.id)!;
  const moduleScope = await resolve(moduleToken);
  assert.equal(moduleScope.statusCode, 200);
  assert.deepEqual((moduleScope.payload as { scope: { activities: Array<{ id: string }> } }).scope.activities.map(({ id }) => id), [activityOne.id]);
  assert.equal(JSON.stringify(moduleScope.payload).includes(moduleTwo.id), false);
  const activityScope = await resolve(activityToken);
  assert.equal(activityScope.statusCode, 200);
  assert.deepEqual((activityScope.payload as { scope: { activities: Array<{ id: string }> } }).scope.activities.map(({ id }) => id), [activityOne.id]);
  assert.equal(JSON.stringify(activityScope.payload).includes(outsideActivity.id), false);
  const otherModuleScope = await resolve(otherModuleToken);
  assert.equal(otherModuleScope.statusCode, 200);
  assert.equal((otherModuleScope.payload as { scope: { module: { id: string } } }).scope.module.id, moduleTwo.id);
  assert.equal((await resolve(otherActivityToken)).statusCode, 200);

  const originalPrimary = structuredClone(createdLinks);
  await save({
    ...savedData,
    modules: savedData.modules?.map((module) => module.id === moduleOne.id ? { ...module, name: 'Renamed Module' } : module),
    activities: savedData.activities?.map((activity) => activity.id === activityOne.id ? { ...activity, title: 'Renamed Activity' } : activity),
  });
  createdLinks = (savedData.isolatedLinks ?? []).filter((link) => link.purpose === 'primary-professor');
  assert.deepEqual(createdLinks.map(({ id, tokenHash, tokenCiphertext }) => ({ id, tokenHash, tokenCiphertext })), originalPrimary.map(({ id, tokenHash, tokenCiphertext }) => ({ id, tokenHash, tokenCiphertext })));

  await save({
    ...savedData,
    isolatedLinks: (savedData.isolatedLinks ?? []).map((link) => link.id === moduleLink.id ? { ...link, status: 'revoked' as const } : link),
  });
  assert.equal((await resolve(moduleToken)).statusCode, 404);
  await save({
    ...savedData,
    isolatedLinks: (savedData.isolatedLinks ?? []).map((link) => link.id === moduleLink.id ? { ...link, status: 'active' as const } : link),
  });
  assert.equal((await resolve(moduleToken)).statusCode, 200);

  await save({
    ...savedData,
    isolatedLinks: (savedData.isolatedLinks ?? []).map((link) => link.id === activityLink.id ? { ...link, status: 'revoked' as const } : link),
  });
  assert.equal((await resolve(activityToken)).statusCode, 404);
  await save({
    ...savedData,
    isolatedLinks: (savedData.isolatedLinks ?? []).map((link) => link.id === activityLink.id ? { ...link, status: 'active' as const } : link),
  });
  assert.equal((await resolve(activityToken)).statusCode, 200);

  await save({
    ...savedData,
    isolatedLinks: (savedData.isolatedLinks ?? []).map((link) => link.id === otherActivityLink.id ? { ...link, expiresAt: '2020-01-01T00:00:00.000Z' } : link),
  });
  assert.equal((await resolve(otherActivityToken)).statusCode, 404);
  await save({
    ...savedData,
    isolatedLinks: (savedData.isolatedLinks ?? []).map((link) => link.id === otherActivityLink.id ? { ...link, expiresAt: null } : link),
  });
  assert.equal((await resolve(otherActivityToken)).statusCode, 200);

  await save({ ...deleteModuleCascade(savedData, moduleTwo.id) });
  assert.equal(savedData.isolatedLinks?.some((link) => link.purpose === 'primary-professor' && link.scopeId === moduleTwo.id), false);
  assert.equal(savedData.isolatedLinks?.some((link) => link.purpose === 'primary-professor' && link.scopeId === outsideActivity.id), false);
  assert.equal((await resolve(otherModuleToken)).statusCode, 404);
  assert.equal((await resolve(otherActivityToken)).statusCode, 404);
  await save(deleteActivityCascade(savedData, activityOne.id));
  assert.equal(savedData.isolatedLinks?.some((link) => link.purpose === 'primary-professor' && link.scopeId === activityOne.id), false);
  assert.equal((await resolve(activityToken)).statusCode, 404);
});

test('archive validation prevents duplicate primary links for one target', () => {
  const first = makeLink({ purpose: 'primary-professor' });
  const second = makeLink({ id: 'duplicate-primary', purpose: 'primary-professor' });
  assert.throws(() => parseAcademicArchive({ ...archive, isolatedLinks: [first, second] }));
});

function issuedTokenFor(link: IsolatedLink) {
  const token = createIsolatedToken();
  return { token, link: { ...link, tokenHash: token.tokenHash } };
}

test('invalid, revoked, expired, and missing-target links all fail closed', () => {
  const active = createIsolatedToken();
  const validLink = makeLink({ tokenHash: active.tokenHash });
  assert.throws(() => resolveIsolatedScope({ ...archive, isolatedLinks: [validLink] }, 'guessable-token'), (error: unknown) => error instanceof ApiError && error.status === 404);

  const revoked = { ...validLink, status: 'revoked' as const };
  assert.throws(() => resolveIsolatedScope({ ...archive, isolatedLinks: [revoked] }, active.token), (error: unknown) => error instanceof ApiError && error.status === 404);

  const expired = { ...validLink, expiresAt: '2020-01-01T00:00:00.000Z' };
  assert.throws(() => resolveIsolatedScope({ ...archive, isolatedLinks: [expired] }, active.token, Date.now()), (error: unknown) => error instanceof ApiError && error.status === 404);

  const missingTarget = { ...validLink, scopeId: 'module-missing' };
  assert.throws(() => resolveIsolatedScope({ ...archive, isolatedLinks: [missingTarget] }, active.token), (error: unknown) => error instanceof ApiError && error.status === 404);
});

test('archive schema validates isolated-link targets, token hash uniqueness, status, scope and expiration', () => {
  const token = createIsolatedToken();
  const link = makeLink({ tokenHash: token.tokenHash });
  assert.doesNotThrow(() => parseAcademicArchive({ ...archive, isolatedLinks: [link] }));
  assert.throws(() => parseAcademicArchive({ ...archive, isolatedLinks: [{ ...link, scopeId: 'missing-module' }] }));
  assert.throws(() => parseAcademicArchive({ ...archive, isolatedLinks: [link, { ...link, id: 'link-two' }] }));
  assert.throws(() => parseAcademicArchive({ ...archive, isolatedLinks: [{ ...link, status: 'disabled' }] }));
  assert.throws(() => parseAcademicArchive({ ...archive, isolatedLinks: [{ ...link, expiresAt: 'not-a-date' }] }));
});

test('isolated routes require a path token and query parameters cannot enable scope access', () => {
  assert.equal(ADMIN_ISOLATED_LINKS_ROUTE, `${ADMIN_ROUTE}/isolated-links`);
  assert.equal(resolveApplicationMode(ADMIN_ISOLATED_LINKS_ROUTE, ''), 'admin');
  assert.equal(resolveApplicationMode('/assessment/AbCdEf0123456789_AbCdEf0123456789_AbCdEf01234', ''), 'isolated');
  assert.equal(resolveApplicationMode('/', '?scope=module-one'), 'public');
  assert.equal(resolveApplicationMode('/', '?mode=isolated&module=module-one'), 'public');
});

test('Admin token issuance validates targets and returns a digest-backed random token without storing it', async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = (async () => githubArchiveResponse()) as typeof fetch;
  try {
    const firstResponse = createResponse();
    await tokenHandler(createRequest('POST', { scopeType: 'module', scopeId: moduleOne.id }, { cookie: adminCookie() }), firstResponse);
    const first = firstResponse.payload as { success: boolean; link: IsolatedLink; token: string };
    assert.equal(firstResponse.statusCode, 200);
    assert.equal(first.success, true);
    assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(first.link.status, 'active');
    assert.equal(first.link.scopeType, 'module');
    assert.equal(first.link.scopeId, moduleOne.id);
    assert.equal(first.link.tokenHash.length, 64);
    assert.equal(first.link.tokenHash.includes(first.token), false);
    assert.equal(decryptIsolatedToken(getServerConfig(), first.link.tokenCiphertext), first.token);

    const secondResponse = createResponse();
    await tokenHandler(createRequest('POST', { scopeType: 'module', scopeId: moduleOne.id }, { cookie: adminCookie() }), secondResponse);
    const second = secondResponse.payload as { token: string; link: IsolatedLink };
    assert.notEqual(first.token, second.token);
    assert.notEqual(first.link.tokenHash, second.link.tokenHash);

    const invalidResponse = createResponse();
    await tokenHandler(createRequest('POST', { scopeType: 'module', scopeId: 'module-missing' }, { cookie: adminCookie() }), invalidResponse);
    assert.equal(invalidResponse.statusCode, 400);
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('Admin refresh restores only active non-expired share tokens from GitHub-backed ciphertext', async () => {
  const issued = createIsolatedToken();
  const activeLink = makeLink({
    tokenHash: issued.tokenHash,
    tokenCiphertext: encryptIsolatedToken(getServerConfig(), issued.token),
  });
  const expiredToken = createIsolatedToken();
  const expiredLink = makeLink({
    id: 'expired-link',
    tokenHash: expiredToken.tokenHash,
    tokenCiphertext: encryptIsolatedToken(getServerConfig(), expiredToken.token),
    expiresAt: '2020-01-01T00:00:00.000Z',
  });
  const revokedToken = createIsolatedToken();
  const revokedLink = makeLink({
    id: 'revoked-link',
    tokenHash: revokedToken.tokenHash,
    tokenCiphertext: encryptIsolatedToken(getServerConfig(), revokedToken.token),
    status: 'revoked',
  });
  globalThis.fetch = (async () => githubArchiveResponse({ ...archive, isolatedLinks: [activeLink, expiredLink, revokedLink] })) as typeof fetch;
  const response = createResponse();
  await tokenHandler(createRequest('GET', undefined, { cookie: adminCookie() }), response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual((response.payload as { links: Array<{ id: string; token: string }> }).links, [{ id: activeLink.id, token: issued.token }]);
});

test('public resolver needs no Admin cookie and never returns token hashes, other links, or administrative data', async () => {
  const issued = createIsolatedToken();
  const link = makeLink({ tokenHash: issued.tokenHash });
  const data = { ...archive, isolatedLinks: [link, makeLink({ id: 'other-link', tokenHash: 'b'.repeat(64), scopeId: moduleTwo.id })] };
  let archiveReads = 0;
  globalThis.fetch = (async () => {
    archiveReads += 1;
    return githubArchiveResponse(data);
  }) as typeof fetch;
  const response = createResponse();
  await resolveHandler(createRequest('GET', undefined, {}, `/api/isolated/resolve?token=${encodeURIComponent(issued.token)}`), response);
  assert.equal(response.statusCode, 200);
  assert.equal(archiveReads, 1);
  assert.equal(response.headers.get('cache-control'), 'no-store, private');
  const serialized = JSON.stringify(response.payload);
  assert.equal(serialized.includes(link.tokenHash), false);
  assert.equal(serialized.includes('other-link'), false);
  assert.equal(serialized.includes('PRIVATE-CNE-DO-NOT-LEAK'), false);
  assert.equal(serialized.includes('PRIVATE-APOGEE-DO-NOT-LEAK'), false);
  assert.equal(serialized.includes('PRIVATE-BIOGRAPHY-DO-NOT-LEAK'), false);
  assert.equal(serialized.includes('ADMIN-FEEDBACK-DO-NOT-LEAK'), false);
  assert.equal(serialized.includes(process.env.GITHUB_PAT!), false);
  assert.equal(serialized.includes(process.env.ADMIN_SESSION_SECRET!), false);
});

test('Professor feedback is persisted only for the active token scope and cannot update academic archive fields', async () => {
  const token = createIsolatedToken();
  const link = makeLink({ tokenHash: token.tokenHash, scopeType: 'module', scopeId: moduleOne.id });
  let savedData = { ...archive, isolatedLinks: [link], professorFeedback: [] as Array<Record<string, unknown>> };
  let currentSha = 'a'.repeat(40);
  let writes = 0;
  globalThis.fetch = (async (_input: string | URL | Request, init: RequestInit = {}) => {
    if (init.method?.toUpperCase() === 'PUT') {
      const requestBody = JSON.parse(String(init.body)) as { content: string; sha: string };
      assert.equal(requestBody.sha, currentSha);
      savedData = JSON.parse(Buffer.from(requestBody.content, 'base64').toString('utf8')) as typeof savedData;
      currentSha = String.fromCharCode('b'.charCodeAt(0) + writes).repeat(40);
      writes += 1;
      return new Response(JSON.stringify({
        content: { sha: currentSha },
        commit: { sha: 'c'.repeat(40) },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return githubArchiveResponse(savedData, currentSha);
  }) as typeof fetch;

  const feedbackUrl = (activityId: string) => `/api/isolated/feedback?token=${encodeURIComponent(token.token)}&activityId=${encodeURIComponent(activityId)}`;
  const initialRead = createResponse();
  await feedbackHandler(createRequest('GET', undefined, {}, feedbackUrl(activityOne.id)), initialRead);
  assert.equal(initialRead.statusCode, 200);
  assert.equal((initialRead.payload as { feedback: unknown }).feedback, null);

  const submission = { professorName: 'Dr Example', score: 17.5, comments: 'Clear reasoning.', observations: 'Check one citation.' };
  const submitResponse = createResponse();
  await feedbackHandler(createRequest('POST', submission, {}, feedbackUrl(activityOne.id)), submitResponse);
  assert.equal(submitResponse.statusCode, 200, JSON.stringify(submitResponse.payload));
  assert.equal(writes, 1);
  const firstFeedback = savedData.professorFeedback.find((item) => item.activityId === activityOne.id)!;
  assert.equal(firstFeedback.isolatedLinkId, link.id);
  assert.equal(firstFeedback.activityId, activityOne.id);
  assert.equal(firstFeedback.professorName, submission.professorName);
  assert.equal(firstFeedback.score, submission.score);
  assert.equal(JSON.stringify(savedData).includes(token.token), false);
  assert.deepEqual(savedData.modules, archive.modules);
  assert.deepEqual(savedData.activities, archive.activities);
  assert.deepEqual(savedData.assets, archive.assets);
  assert.deepEqual(savedData.isolatedLinks, [link]);

  const secondSubmission = { ...submission, score: 15, comments: 'Different activity assessment.' };
  const secondSubmitResponse = createResponse();
  await feedbackHandler(createRequest('POST', secondSubmission, {}, feedbackUrl(activityTwo.id)), secondSubmitResponse);
  assert.equal(secondSubmitResponse.statusCode, 200);
  assert.equal(writes, 2);
  assert.equal(savedData.professorFeedback.length, 2);

  const restoredRead = createResponse();
  await feedbackHandler(createRequest('GET', undefined, {}, feedbackUrl(activityOne.id)), restoredRead);
  assert.equal(restoredRead.statusCode, 200);
  const publicFeedback = (restoredRead.payload as { feedback: Record<string, unknown> }).feedback;
  assert.deepEqual(publicFeedback, {
    professorName: submission.professorName,
    score: submission.score,
    comments: submission.comments,
    observations: submission.observations,
    submittedAt: firstFeedback.submittedAt,
  });
  assert.equal('isolatedLinkId' in publicFeedback, false);
  assert.equal('activityId' in publicFeedback, false);
  const secondActivityRead = createResponse();
  await feedbackHandler(createRequest('GET', undefined, {}, feedbackUrl(activityTwo.id)), secondActivityRead);
  assert.equal((secondActivityRead.payload as { feedback: { score: number } }).feedback.score, secondSubmission.score);

  const tamperedResponse = createResponse();
  await feedbackHandler(createRequest('POST', { ...submission, scopeId: moduleTwo.id, modules: [] }, {}, feedbackUrl(activityOne.id)), tamperedResponse);
  assert.equal(tamperedResponse.statusCode, 400);
  const wrongActivityResponse = createResponse();
  await feedbackHandler(createRequest('GET', undefined, {}, feedbackUrl(outsideActivity.id)), wrongActivityResponse);
  assert.equal(wrongActivityResponse.statusCode, 404);
  assert.equal(writes, 2);

  savedData = { ...savedData, isolatedLinks: [{ ...link, status: 'revoked' }] };
  const revokedResponse = createResponse();
  await feedbackHandler(createRequest('GET', undefined, {}, feedbackUrl(activityOne.id)), revokedResponse);
  assert.equal(revokedResponse.statusCode, 404);

  savedData = { ...savedData, isolatedLinks: [{ ...link, expiresAt: '2020-01-01T00:00:00.000Z' }] };
  const expiredResponse = createResponse();
  await feedbackHandler(createRequest('POST', submission, {}, feedbackUrl(activityTwo.id)), expiredResponse);
  assert.equal(expiredResponse.statusCode, 404);
  assert.equal(writes, 2);
});

test('saved module and activity links survive reload, resolve independently, revoke, and reactivate', async () => {
  let savedData = structuredClone(archive);
  let currentSha = 'a'.repeat(40);
  let writeCount = 0;
  globalThis.fetch = (async (_input: string | URL | Request, init: RequestInit = {}) => {
    if (init.method?.toUpperCase() === 'PUT') {
      const requestBody = JSON.parse(String(init.body)) as { content: string; sha: string };
      assert.equal(requestBody.sha, currentSha);
      savedData = JSON.parse(Buffer.from(requestBody.content, 'base64').toString('utf8')) as typeof archive;
      currentSha = String.fromCharCode('b'.charCodeAt(0) + writeCount).repeat(40);
      writeCount += 1;
      return new Response(JSON.stringify({
        content: { sha: currentSha },
        commit: { sha: 'f'.repeat(40) },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return githubArchiveResponse(savedData, currentSha);
  }) as typeof fetch;

  async function issue(scopeType: 'module' | 'activity', scopeId: string) {
    const response = createResponse();
    await tokenHandler(createRequest('POST', { scopeType, scopeId }, { cookie: adminCookie() }), response);
    assert.equal(response.statusCode, 200);
    return response.payload as { link: IsolatedLink; token: string };
  }

  async function save(data: typeof archive) {
    const response = createResponse();
    await dataHandler(createRequest('PUT', { data, sha: currentSha, message: 'Update isolated links' }, { cookie: adminCookie() }), response);
    assert.equal(response.statusCode, 200, JSON.stringify(response.payload));
    return response.payload as { success: boolean; contentSha: string; commitSha: string; links: Array<{ id: string; token: string }> };
  }

  async function reloadShareUrls() {
    const response = createResponse();
    await tokenHandler(createRequest('GET', undefined, { cookie: adminCookie() }), response);
    assert.equal(response.statusCode, 200);
    return (response.payload as { links: Array<{ id: string; token: string }> }).links;
  }

  async function open(token: string) {
    const response = createResponse();
    await resolveHandler(createRequest('GET', undefined, {}, `/api/isolated/resolve?token=${encodeURIComponent(token)}`), response);
    return response;
  }

  const moduleIssue = await issue('module', moduleOne.id);
  assert.equal((await open(moduleIssue.token)).statusCode, 404, 'issued draft must not resolve before Save');
  const moduleSave = await save({ ...savedData, isolatedLinks: [moduleIssue.link] });
  assert.equal(moduleSave.success, true);
  assert.equal(moduleSave.contentSha, currentSha);
  assert.deepEqual(moduleSave.links, [{ id: moduleIssue.link.id, token: moduleIssue.token }]);
  const reloadedModuleData = structuredClone(savedData);
  assert.deepEqual(reloadedModuleData.isolatedLinks?.[0], moduleIssue.link);
  assert.equal(JSON.stringify(reloadedModuleData).includes(moduleIssue.token), false);
  assert.equal(JSON.stringify(reloadedModuleData).includes(process.env.GITHUB_PAT!), false);
  assert.equal(JSON.stringify(reloadedModuleData).includes(process.env.ADMIN_SESSION_SECRET!), false);
  assert.deepEqual(await reloadShareUrls(), [{ id: moduleIssue.link.id, token: moduleIssue.token }]);
  const moduleOpen = await open(moduleIssue.token);
  assert.equal(moduleOpen.statusCode, 200);
  assert.deepEqual((moduleOpen.payload as { scope: { module: { id: string }; activities: Array<{ id: string }> } }).scope.activities.map(({ id }) => id), [activityOne.id, activityTwo.id]);

  const activityIssue = await issue('activity', activityOne.id);
  const activitySave = await save({ ...savedData, isolatedLinks: [...savedData.isolatedLinks, activityIssue.link] });
  assert.equal(activitySave.success, true);
  assert.deepEqual(activitySave.links, [
    { id: moduleIssue.link.id, token: moduleIssue.token },
    { id: activityIssue.link.id, token: activityIssue.token },
  ]);
  assert.deepEqual(await reloadShareUrls(), [
    { id: moduleIssue.link.id, token: moduleIssue.token },
    { id: activityIssue.link.id, token: activityIssue.token },
  ]);
  const activityOpen = await open(activityIssue.token);
  assert.equal(activityOpen.statusCode, 200);
  assert.deepEqual((activityOpen.payload as { scope: { scopeId: string; activities: Array<{ id: string }> } }).scope.activities.map(({ id }) => id), [activityOne.id]);

  const revokedData = {
    ...savedData,
    isolatedLinks: savedData.isolatedLinks.map((link) => link.id === moduleIssue.link.id ? { ...link, status: 'revoked' as const } : link),
  };
  const revokedSave = await save(revokedData);
  assert.deepEqual(revokedSave.links, [{ id: activityIssue.link.id, token: activityIssue.token }]);
  assert.equal(savedData.isolatedLinks.find((link) => link.id === moduleIssue.link.id)?.status, 'revoked');
  assert.deepEqual(await reloadShareUrls(), [{ id: activityIssue.link.id, token: activityIssue.token }]);
  assert.equal((await open(moduleIssue.token)).statusCode, 404);

  const activatedData = {
    ...savedData,
    isolatedLinks: savedData.isolatedLinks.map((link) => link.id === moduleIssue.link.id ? { ...link, status: 'active' as const } : link),
  };
  const activatedSave = await save(activatedData);
  assert.deepEqual(activatedSave.links, [
    { id: moduleIssue.link.id, token: moduleIssue.token },
    { id: activityIssue.link.id, token: activityIssue.token },
  ]);
  assert.equal(savedData.isolatedLinks.find((link) => link.id === moduleIssue.link.id)?.status, 'active');
  assert.deepEqual((await reloadShareUrls()).find(({ id }) => id === moduleIssue.link.id), { id: moduleIssue.link.id, token: moduleIssue.token });
  assert.equal((await open(moduleIssue.token)).statusCode, 200);
  assert.equal((await open(`${moduleIssue.token.slice(0, -1)}x`)).statusCode, 404);
  assert.equal(writeCount, 4);
});

test('Generate Link keeps the saved token valid until Save, rotates it on Save, and rejects revoked links', async () => {
  const originalToken = createIsolatedToken();
  const originalLink = makeLink({
    tokenHash: originalToken.tokenHash,
    tokenCiphertext: encryptIsolatedToken(getServerConfig(), originalToken.token),
  });
  let savedData = { ...archive, isolatedLinks: [originalLink] };
  let currentSha = 'a'.repeat(40);
  let writeCount = 0;
  globalThis.fetch = (async (_input: string | URL | Request, init: RequestInit = {}) => {
    if (init.method?.toUpperCase() === 'PUT') {
      const requestBody = JSON.parse(String(init.body)) as { content: string; sha: string };
      assert.equal(requestBody.sha, currentSha);
      savedData = JSON.parse(Buffer.from(requestBody.content, 'base64').toString('utf8')) as typeof savedData;
      currentSha = writeCount === 0 ? 'b'.repeat(40) : 'c'.repeat(40);
      writeCount += 1;
      return new Response(JSON.stringify({
        content: { sha: currentSha },
        commit: { sha: 'f'.repeat(40) },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return githubArchiveResponse(savedData, currentSha);
  }) as typeof fetch;

  const issueResponse = createResponse();
  await tokenHandler(createRequest('POST', { id: originalLink.id }, { cookie: adminCookie() }), issueResponse);
  assert.equal(issueResponse.statusCode, 200);
  const replacement = issueResponse.payload as { link: IsolatedLink; token: string };
  assert.equal(replacement.link.id, originalLink.id);
  assert.equal(replacement.link.scopeId, originalLink.scopeId);
  assert.notEqual(replacement.link.tokenHash, originalLink.tokenHash);

  async function open(token: string) {
    const response = createResponse();
    await resolveHandler(createRequest('GET', undefined, {}, `/api/isolated/resolve?token=${encodeURIComponent(token)}`), response);
    return response.statusCode;
  }

  assert.equal(await open(originalToken.token), 200);
  assert.equal(await open(replacement.token), 404);
  const updateResponse = createResponse();
  await dataHandler(createRequest('PUT', {
    data: { ...savedData, isolatedLinks: [replacement.link] },
    sha: currentSha,
    message: 'Rotate isolated link token',
  }, { cookie: adminCookie() }), updateResponse);
  assert.equal(updateResponse.statusCode, 200, JSON.stringify(updateResponse.payload));
  assert.equal(JSON.stringify(savedData).includes(replacement.token), false);
  assert.equal(await open(originalToken.token), 404);
  assert.equal(await open(replacement.token), 200);

  const revokedData = {
    ...savedData,
    isolatedLinks: savedData.isolatedLinks.map((link) => ({ ...link, status: 'revoked' as const })),
  };
  const revokeResponse = createResponse();
  await dataHandler(createRequest('PUT', { data: revokedData, sha: currentSha }, { cookie: adminCookie() }), revokeResponse);
  assert.equal(revokeResponse.statusCode, 200);
  const revokedIssueResponse = createResponse();
  await tokenHandler(createRequest('POST', { id: originalLink.id }, { cookie: adminCookie() }), revokedIssueResponse);
  assert.equal(revokedIssueResponse.statusCode, 409);
  assert.equal(writeCount, 2);
});

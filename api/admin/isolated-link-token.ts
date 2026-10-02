import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_lib/platform.ts';
import { getAdminAuthContext, sendAdminFailure } from '../_lib/admin-session.ts';
import { getServerConfig, type ServerConfig } from '../_lib/config.ts';
import { ApiError } from '../_lib/errors.ts';
import { getGithubData, updateGithubData } from '../_lib/github.ts';
import { activeIsolatedTokenUrls, createIsolatedToken, encryptIsolatedToken, ensurePrimaryProfessorLinks, validateIsolatedScopeType } from '../_lib/isolated-links.ts';
import { readJsonBody, requireJsonContentType, requireRecord, requireSameOrigin, sendFailure, sendSuccess } from '../_lib/http.ts';
import type { IsolatedLink } from '../../src/types/academic.ts';

export const config = { api: { bodyParser: false } };

const ALLOWED_KEYS = new Set(['id', 'scopeType', 'scopeId', 'expiresAt']);

function parseExpiration(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    throw new ApiError(400, 'INVALID_EXPIRATION', 'Expiration must be a valid date and time with a timezone.');
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
    throw new ApiError(400, 'INVALID_EXPIRATION', 'Expiration must be in the future.');
  }
  return new Date(timestamp).toISOString();
}

function assertAllowedKeys(body: Record<string, unknown>) {
  if (Object.keys(body).some((key) => !ALLOWED_KEYS.has(key))) {
    throw new ApiError(400, 'INVALID_ISOLATED_LINK_REQUEST', 'The isolated-link request contains unsupported fields.');
  }
}

async function readPostBody(request: VercelRequest) {
  requireSameOrigin(request);
  requireJsonContentType(request);
  return requireRecord(await readJsonBody(request));
}

async function issueToken(body: Record<string, unknown>, serverConfig: ServerConfig) {
  assertAllowedKeys(body);
  const current = await getGithubData(serverConfig);
  const links = current.data.isolatedLinks ?? [];

  let existing: IsolatedLink | undefined;
  let id: string;
  let scopeType: IsolatedLink['scopeType'];
  let scopeId: string;
  let expiresAt: string | null;

  if (body.id !== undefined) {
    if (typeof body.id !== 'string') throw new ApiError(400, 'INVALID_ISOLATED_LINK_ID', 'The isolated-link identifier is invalid.');
    existing = links.find((link) => link.id === body.id);
    if (!existing) throw new ApiError(404, 'ISOLATED_LINK_NOT_FOUND', 'The isolated link was not found.');
    if (existing.status !== 'active') throw new ApiError(409, 'ISOLATED_LINK_REVOKED', 'Activate the isolated link before issuing a replacement token.');
    id = existing.id;
    scopeType = existing.scopeType;
    scopeId = existing.scopeId;
    expiresAt = existing.expiresAt;
    if (body.scopeType !== undefined || body.scopeId !== undefined || body.expiresAt !== undefined) {
      throw new ApiError(400, 'INVALID_ISOLATED_LINK_REQUEST', 'A replacement token cannot change the saved link scope or expiration.');
    }
  } else {
    if (!validateIsolatedScopeType(body.scopeType)) {
      throw new ApiError(400, 'INVALID_ISOLATED_SCOPE', 'Choose a module or activity scope.');
    }
    if (typeof body.scopeId !== 'string' || !body.scopeId.trim() || body.scopeId.length > 128) {
      throw new ApiError(400, 'INVALID_ISOLATED_SCOPE', 'Choose an existing scope target.');
    }
    scopeType = body.scopeType;
    scopeId = body.scopeId;
    expiresAt = parseExpiration(body.expiresAt);
    id = randomUUID();
    const targetExists = scopeType === 'module'
      ? (current.data.modules ?? []).some((module) => module.id === scopeId)
      : (current.data.activities ?? []).some((activity) => activity.id === scopeId);
    if (!targetExists) throw new ApiError(400, 'INVALID_ISOLATED_SCOPE', 'The selected scope target does not exist.');
  }

  let token = '';
  let tokenHash = '';
  do {
    ({ token, tokenHash } = createIsolatedToken());
  } while (links.some((link) => link.tokenHash === tokenHash));

  const link: IsolatedLink = {
    id,
    tokenHash,
    tokenCiphertext: encryptIsolatedToken(serverConfig, token),
    scopeType,
    scopeId,
    ...(existing?.purpose ? { purpose: existing.purpose } : {}),
    status: 'active',
    expiresAt,
  };
  return { link, token };
}

async function provisionPrimaryLinks(serverConfig: ServerConfig) {
  const current = await getGithubData(serverConfig);
  const provisioned = ensurePrimaryProfessorLinks(current.data, current.data, serverConfig);
  let sha = current.sha;
  if (provisioned.changed) {
    const result = await updateGithubData(serverConfig, provisioned.data, current.sha, 'Provision primary Professor Links');
    sha = result.contentSha;
  }
  return {
    data: provisioned.data,
    sha,
    links: activeIsolatedTokenUrls(provisioned.data.isolatedLinks ?? [], serverConfig),
  };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return sendFailure(response, new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'));
  }
  let serverConfig: ServerConfig | undefined;
  try {
    serverConfig = getServerConfig();
    getAdminAuthContext(request, response, serverConfig);
    if (request.method === 'GET') {
      const { data } = await getGithubData(serverConfig);
      const links = activeIsolatedTokenUrls(data.isolatedLinks ?? [], serverConfig);
      return sendSuccess(response, { links });
    }
    const body = await readPostBody(request);
    if (body.action === 'provision-primary-links') {
      if (Object.keys(body).length !== 1) {
        throw new ApiError(400, 'INVALID_ISOLATED_LINK_REQUEST', 'The isolated-link request contains unsupported fields.');
      }
      return sendSuccess(response, await provisionPrimaryLinks(serverConfig));
    }
    const result = await issueToken(body, serverConfig);
    return sendSuccess(response, result);
  } catch (error) {
    return sendAdminFailure(response, error, serverConfig);
  }
}
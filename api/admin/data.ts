import type { VercelRequest, VercelResponse } from '../_lib/platform.ts';
import { isDeepStrictEqual } from 'node:util';
import { getAdminAuthContext, sendAdminFailure } from '../_lib/admin-session.ts';
import { getServerConfig, type ServerConfig } from '../_lib/config.ts';
import { getGithubData, updateGithubData } from '../_lib/github.ts';
import { ApiError } from '../_lib/errors.ts';
import {
  MAX_DATA_BODY_BYTES,
  readJsonBody,
  requireJsonContentType,
  requireRecord,
  requireSameOrigin,
  sendFailure,
  sendSuccess,
} from '../_lib/http.ts';
import {
  normalizeProfileForWrite,
  parseAcademicArchive,
  validateAcademicYearsTransition,
} from '../_lib/archive-schema.ts';
import { activeIsolatedTokenUrls, ensurePrimaryProfessorLinks } from '../_lib/isolated-links.ts';

export const config = { api: { bodyParser: false } };

const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const ALLOWED_UPDATE_KEYS = new Set(['data', 'sha', 'message']);

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'GET' && request.method !== 'PUT') {
    response.setHeader('Allow', 'GET, PUT');
    return sendFailure(response, new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'));
  }

  let serverConfig: ServerConfig | undefined;
  try {
    serverConfig = getServerConfig();
    getAdminAuthContext(request, response, serverConfig);

    if (request.method === 'GET') {
      const result = await getGithubData(serverConfig);
      return sendSuccess(response, result);
    }

    requireSameOrigin(request);
    requireJsonContentType(request);
    const body = requireRecord(await readJsonBody(request, MAX_DATA_BODY_BYTES));
    if (Object.keys(body).some((key) => !ALLOWED_UPDATE_KEYS.has(key))) {
      throw new ApiError(400, 'INVALID_UPDATE', 'The update request contains unsupported fields.');
    }
    if (typeof body.sha !== 'string' || !SHA_PATTERN.test(body.sha)) {
      throw new ApiError(400, 'INVALID_SHA', 'A valid current data SHA is required.');
    }

    const message = body.message === undefined ? 'Update academic portfolio data' : body.message;
    if (
      typeof message !== 'string'
      || message.trim().length === 0
      || message.length > 120
      || /[\u0000-\u001f\u007f]/.test(message)
    ) {
      throw new ApiError(400, 'INVALID_COMMIT_MESSAGE', 'Commit message must be plain text of at most 120 characters.');
    }

    const parsedData = parseAcademicArchive(body.data);
    const currentData = await getGithubData(serverConfig);
    if (currentData.sha !== body.sha) {
      throw new ApiError(409, 'GITHUB_CONFLICT', 'The academic data changed on GitHub. Reload the current data before saving again.');
    }
    validateAcademicYearsTransition(currentData.data.years, parsedData.years);
    const withPrimaryLinks = ensurePrimaryProfessorLinks(parsedData, currentData.data, serverConfig, false).data;
    const normalizedData = parseAcademicArchive(withPrimaryLinks);
    const profileChanged = !isDeepStrictEqual(normalizedData.profile, currentData.data.profile);
    const data = profileChanged
      ? { ...normalizedData, profile: normalizeProfileForWrite(normalizedData.profile) }
      : normalizedData;
    const serializedBytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
    if (serializedBytes > MAX_DATA_BODY_BYTES) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Academic data payload is too large.');
    }

    const result = await updateGithubData(serverConfig, data, body.sha, message.trim());
    return sendSuccess(response, {
      ...result,
      data,
      links: activeIsolatedTokenUrls(data.isolatedLinks ?? [], serverConfig),
    });
  } catch (error) {
    return sendAdminFailure(response, error, serverConfig);
  }
}
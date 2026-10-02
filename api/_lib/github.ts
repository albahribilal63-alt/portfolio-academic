import { ApiError } from './errors.ts';
import { parseAcademicArchive } from './archive-schema.ts';
import type { ServerConfig } from './config.ts';
import { MAX_ASSET_FILE_BYTES, MAX_DATA_BODY_BYTES, MAX_GITHUB_RESPONSE_BYTES } from './limits.ts';

const GITHUB_API = 'https://api.github.com';
const GITHUB_API_VERSION = '2026-03-10';
const SHA_PATTERN = /^[a-f0-9]{40}$/i;

function apiPath(config: ServerConfig) {
  const encodedPath = config.githubDataPath.split('/').map(encodeURIComponent).join('/');
  return `/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubRepo)}/contents/${encodedPath}`;
}

function mapGithubError(status: number, remaining: string | null): ApiError {
  if (status === 401) return new ApiError(401, 'GITHUB_AUTH_FAILED', 'GitHub authentication failed.');
  if (status === 403 && remaining === '0') return new ApiError(429, 'GITHUB_RATE_LIMITED', 'GitHub rate limit reached. Try again later.');
  if (status === 403) return new ApiError(403, 'GITHUB_ACCESS_DENIED', 'GitHub access was denied.');
  if (status === 404) return new ApiError(404, 'GITHUB_RESOURCE_NOT_FOUND', 'The configured repository or data file was not found.');
  if (status === 409) return new ApiError(409, 'GITHUB_CONFLICT', 'The academic data changed on GitHub. Reload the current data before saving again.');
  if (status === 422) return new ApiError(422, 'GITHUB_VALIDATION_FAILED', 'GitHub rejected the requested content update.');
  if (status === 429) return new ApiError(429, 'GITHUB_RATE_LIMITED', 'GitHub rate limit reached. Try again later.');
  if (status >= 500) return new ApiError(503, 'GITHUB_UNAVAILABLE', 'GitHub is temporarily unavailable.');
  return new ApiError(502, 'GITHUB_REQUEST_FAILED', 'The GitHub request could not be completed.');
}

function redactDiagnostic(value: string, config: ServerConfig): string {
  let safeValue = value.slice(0, 500);
  for (const secret of [config.githubPat, process.env.ADMIN_SESSION_SECRET]) {
    if (secret) safeValue = safeValue.split(secret).join('[redacted]');
  }
  safeValue = safeValue.replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]');
  if (/\b(?:sensitive|secret|password|authorization)\b/i.test(safeValue)) {
    return 'GitHub returned an error response.';
  }
  return safeValue;
}

async function readGithubErrorDetails(response: Response, config: ServerConfig) {
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await response.text());
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
  }

  const errors = Array.isArray(body.errors) ? body.errors : [];
  const firstError = errors[0];
  const errorType = typeof body.type === 'string'
    ? body.type
    : typeof firstError === 'object' && firstError !== null && 'code' in firstError && typeof firstError.code === 'string'
      ? firstError.code
      : `HTTP_${response.status}`;
  const message = typeof body.message === 'string' ? body.message : 'GitHub returned an error response.';
  return {
    errorType: redactDiagnostic(errorType, config),
    message: redactDiagnostic(message, config),
  };
}

async function githubRequest(config: ServerConfig, path: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${GITHUB_API}${path}`, {
      ...init,
      signal: AbortSignal.timeout(12_000),
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${config.githubPat}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    console.error(JSON.stringify({
      event: 'github_request_failed',
      endpoint: path,
      status: null,
      errorType: 'GITHUB_UNAVAILABLE',
      message: 'No HTTP response was received from GitHub.',
    }));
    throw new ApiError(503, 'GITHUB_UNAVAILABLE', 'GitHub is temporarily unavailable.');
  }

  if (!response.ok) {
    const apiError = mapGithubError(response.status, response.headers.get('x-ratelimit-remaining'));
    const details = await readGithubErrorDetails(response, config);
    console.error(JSON.stringify({
      event: 'github_request_failed',
      endpoint: path,
      status: response.status,
      errorType: details.errorType,
      message: details.message,
    }));
    if (init.method?.toUpperCase() === 'PUT' && details.message !== 'GitHub returned an error response.') {
      throw new ApiError(apiError.status, apiError.code, details.message);
    }
    throw apiError;
  }
  if (init.method?.toUpperCase() === 'PUT') {
    console.info(JSON.stringify({ event: 'github_request_succeeded', endpoint: path, status: response.status }));
  }
  try {
    const declaredSize = Number(response.headers.get('content-length') ?? 0);
    if (declaredSize > MAX_GITHUB_RESPONSE_BYTES) {
      throw new ApiError(502, 'GITHUB_RESPONSE_TOO_LARGE', 'GitHub returned an unexpectedly large response.');
    }
    if (!response.body) throw new Error('Missing response body.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_GITHUB_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ApiError(502, 'GITHUB_RESPONSE_TOO_LARGE', 'GitHub returned an unexpectedly large response.');
      }
      chunks.push(value);
    }
    const responseText = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    return JSON.parse(responseText) as unknown;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'GITHUB_INVALID_RESPONSE', 'GitHub returned an invalid response.');
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError(502, 'GITHUB_INVALID_RESPONSE', 'GitHub returned an invalid response.');
  }
  return value as Record<string, unknown>;
}

export async function getGithubUser(config: ServerConfig): Promise<string> {
  const user = asRecord(await githubRequest(config, '/user'));
  if (typeof user.login !== 'string' || !user.login) {
    throw new ApiError(502, 'GITHUB_INVALID_RESPONSE', 'GitHub returned an invalid response.');
  }
  return user.login;
}

export async function verifyRepositoryWriteAccess(config: ServerConfig) {
  const repository = asRecord(await githubRequest(
    config,
    `/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubRepo)}`,
  ));
  const permissions = repository.permissions;
  const pushPermission = typeof permissions === 'object' && permissions !== null && !Array.isArray(permissions)
    ? (permissions as Record<string, unknown>).push === true
    : false;
  if (!pushPermission) {
    throw new ApiError(403, 'GITHUB_WRITE_PERMISSION_REQUIRED', 'GitHub credential does not have the required repository permissions.');
  }
}

function decodeGithubContent(response: unknown, config: ServerConfig) {
  const file = asRecord(response);
  if (file.encoding !== 'base64' || typeof file.content !== 'string' || typeof file.sha !== 'string' || !SHA_PATTERN.test(file.sha)) {
    throw new ApiError(502, 'GITHUB_INVALID_RESPONSE', 'GitHub returned an invalid data file response.');
  }

  try {
    const encodedContent = file.content.replace(/\s/g, '');
    if (encodedContent.length > Math.ceil(MAX_DATA_BODY_BYTES / 3) * 4) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Academic data payload is too large.');
    }
    const bytes = Buffer.from(encodedContent, 'base64');
    if (bytes.byteLength > MAX_DATA_BODY_BYTES) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Academic data payload is too large.');
    }
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const data = parseAcademicArchive(JSON.parse(json) as unknown);
    return { data, sha: file.sha, path: config.githubDataPath, branch: config.githubBranch };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, 'GITHUB_DATA_INVALID', 'The configured academic data file is invalid.');
  }
}

export async function getGithubData(config: ServerConfig) {
  const query = new URLSearchParams({ ref: config.githubBranch });
  const response = await githubRequest(config, `${apiPath(config)}?${query.toString()}`);
  return decodeGithubContent(response, config);
}

export async function updateGithubData(
  config: ServerConfig,
  data: ReturnType<typeof parseAcademicArchive>,
  sha: string,
  message: string,
) {
  const endpoint = apiPath(config);
  console.info(JSON.stringify({
    event: 'github_content_update_started',
    endpoint,
    branch: config.githubBranch,
    shaPresent: Boolean(sha),
  }));
  const body = JSON.stringify({
    message,
    content: Buffer.from(JSON.stringify(data, null, 2), 'utf8').toString('base64'),
    sha,
    branch: config.githubBranch,
  });
  const response = asRecord(await githubRequest(config, endpoint, { method: 'PUT', body }));
  const content = typeof response.content === 'object' && response.content !== null && !Array.isArray(response.content)
    ? response.content as Record<string, unknown>
    : {};
  const commit = typeof response.commit === 'object' && response.commit !== null && !Array.isArray(response.commit)
    ? response.commit as Record<string, unknown>
    : {};
  if (typeof content.sha !== 'string' || !SHA_PATTERN.test(content.sha) || typeof commit.sha !== 'string' || !SHA_PATTERN.test(commit.sha)) {
    throw new ApiError(502, 'GITHUB_INVALID_RESPONSE', 'GitHub returned an invalid update response.');
  }
  console.info(JSON.stringify({
    event: 'github_content_update_succeeded',
    endpoint,
    shaPresent: Boolean(sha),
    contentShaPresent: true,
    commitShaPresent: true,
  }));
  return { contentSha: content.sha, commitSha: commit.sha };
}

export function configuredRepository(config: ServerConfig) {
  return `${config.githubOwner}/${config.githubRepo}`;
}

function assetApiPath(config: ServerConfig, path: string) {
  if (
    !/^public\/storage\/(?:docs\/[A-Za-z0-9_-]{1,128}\.(?:pdf|docx|xlsx|zip|code)|profile\/[A-Za-z0-9_-]{1,128}\.(?:jpg|png|webp))$/.test(path)
  ) {
    throw new ApiError(400, 'INVALID_ASSET_PATH', 'The file path is outside the allowed storage directory.');
  }
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  return `/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubRepo)}/contents/${encodedPath}`;
}

export async function getGithubAsset(config: ServerConfig, path: string) {
  const query = new URLSearchParams({ ref: config.githubBranch });
  const file = asRecord(await githubRequest(config, `${assetApiPath(config, path)}?${query.toString()}`));
  if (file.encoding !== 'base64' || typeof file.content !== 'string' || typeof file.sha !== 'string' || !SHA_PATTERN.test(file.sha)) {
    throw new ApiError(502, 'GITHUB_INVALID_RESPONSE', 'GitHub returned an invalid file response.');
  }
  const content = Buffer.from(file.content.replace(/\s/g, ''), 'base64');
  if (content.byteLength > MAX_ASSET_FILE_BYTES) {
    throw new ApiError(413, 'ASSET_TOO_LARGE', 'The repository file exceeds the supported file size.');
  }
  return { content, sha: file.sha };
}

export async function putGithubAsset(config: ServerConfig, path: string, content: Buffer, sha: string | undefined, message: string) {
  if (content.byteLength === 0 || content.byteLength > MAX_ASSET_FILE_BYTES) {
    throw new ApiError(content.byteLength === 0 ? 400 : 413, content.byteLength === 0 ? 'EMPTY_FILE' : 'ASSET_TOO_LARGE', 'The file size is not supported.');
  }
  if (sha !== undefined && !SHA_PATTERN.test(sha)) {
    throw new ApiError(400, 'INVALID_FILE_SHA', 'A valid current file SHA is required.');
  }
  const response = asRecord(await githubRequest(config, assetApiPath(config, path), {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: content.toString('base64'),
      ...(sha ? { sha } : {}),
      branch: config.githubBranch,
    }),
  }));
  const file = typeof response.content === 'object' && response.content !== null && !Array.isArray(response.content)
    ? response.content as Record<string, unknown>
    : {};
  if (typeof file.sha !== 'string' || !SHA_PATTERN.test(file.sha)) {
    throw new ApiError(502, 'GITHUB_INVALID_RESPONSE', 'GitHub did not confirm the file update.');
  }
  return { sha: file.sha };
}

export async function deleteGithubAsset(config: ServerConfig, path: string, sha: string, message: string) {
  if (!SHA_PATTERN.test(sha)) throw new ApiError(400, 'INVALID_FILE_SHA', 'A valid current file SHA is required.');
  await githubRequest(config, assetApiPath(config, path), {
    method: 'DELETE',
    body: JSON.stringify({ message, sha, branch: config.githubBranch }),
  });
}
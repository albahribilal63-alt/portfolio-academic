import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_lib/platform.ts';
import { getAdminAuthContext, sendAdminFailure } from '../_lib/admin-session.ts';
import { parseAcademicArchive } from '../_lib/archive-schema.ts';
import { getServerConfig, type ServerConfig } from '../_lib/config.ts';
import { deleteGithubAsset, getGithubAsset, getGithubData, putGithubAsset, updateGithubData } from '../_lib/github.ts';
import { ApiError } from '../_lib/errors.ts';
import { readBinaryBody, readJsonBody, requireJsonContentType, requireRecord, requireSameOrigin, sendFailure, sendSuccess } from '../_lib/http.ts';
import type { AcademicFileType, Asset } from '../../src/types/academic.ts';

export const config = { api: { bodyParser: false } };

const STORAGE_ROOT = 'public/storage/docs';
const EXTENSION_TO_TYPE: Record<string, AcademicFileType> = {
  pdf: 'PDF',
  docx: 'DOCX',
  xlsx: 'XLSX',
  zip: 'ZIP',
  js: 'CODE', mjs: 'CODE', cjs: 'CODE', jsx: 'CODE', ts: 'CODE', tsx: 'CODE',
  py: 'CODE', java: 'CODE', c: 'CODE', h: 'CODE', cc: 'CODE', cpp: 'CODE', hpp: 'CODE',
  cs: 'CODE', go: 'CODE', rs: 'CODE', php: 'CODE', rb: 'CODE', html: 'CODE', css: 'CODE',
  json: 'CODE', xml: 'CODE', sh: 'CODE', sql: 'CODE', md: 'CODE',
};
const TYPE_TO_EXTENSION: Record<AcademicFileType, string> = {
  PDF: 'pdf',
  DOCX: 'docx',
  XLSX: 'xlsx',
  ZIP: 'zip',
  CODE: 'code',
};

function headerValue(request: VercelRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function requireBinaryContentType(request: VercelRequest) {
  if (headerValue(request, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/octet-stream') {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Upload the file as application/octet-stream.');
  }
}

function parseHeaderMetadata(request: VercelRequest): Record<string, unknown> {
  const value = headerValue(request, 'x-asset-metadata');
  if (!value || value.length > 4_096) throw new ApiError(400, 'INVALID_ASSET_METADATA', 'Asset metadata is invalid.');
  try {
    return requireRecord(JSON.parse(value), 'INVALID_ASSET_METADATA');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'INVALID_ASSET_METADATA', 'Asset metadata is invalid.');
  }
}

function assertKeys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ApiError(400, 'INVALID_ASSET_REQUEST', 'The asset request contains unsupported fields.');
  }
}

function fileName(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(400, 'INVALID_FILE_NAME', 'A supported file name is required.');
  const name = value.trim();
  if (!name || name.length > 255 || name === '.' || name === '..' || /[\\/\u0000-\u001f\u007f]/.test(name)) {
    throw new ApiError(400, 'INVALID_FILE_NAME', 'The file name contains unsupported characters.');
  }
  return name;
}

function fileType(name: string): AcademicFileType {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  const type = EXTENSION_TO_TYPE[extension];
  if (!type) throw new ApiError(415, 'UNSUPPORTED_FILE_TYPE', 'Choose a supported document, archive, or source-code file.');
  return type;
}

function canonicalPath(assetId: string, type: AcademicFileType) {
  return `${STORAGE_ROOT}/${assetId}.${TYPE_TO_EXTENSION[type]}`;
}

function checkedAssetPath(asset: Asset) {
  const expected = canonicalPath(asset.id, asset.type);
  if (asset.path !== expected || asset.path.includes('..') || asset.path.includes('\\') || asset.path.startsWith('/')) {
    throw new ApiError(400, 'INVALID_ASSET_PATH', 'The asset path is outside the allowed storage directory.');
  }
  return expected;
}

function orderValue(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 1_000_000) {
    throw new ApiError(400, 'INVALID_ASSET_ORDER', 'Asset order must be a whole number from 1 to 1,000,000.');
  }
  return Number(value);
}

function visibilityValue(value: unknown): Asset['visibility'] {
  if (value !== 'public' && value !== 'private' && value !== 'unlisted') {
    throw new ApiError(400, 'INVALID_ASSET_VISIBILITY', 'Choose a valid asset visibility.');
  }
  return value;
}

function activityValue(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw new ApiError(400, 'INVALID_ACTIVITY_ID', 'Choose an existing activity.');
  }
  return value;
}

function persistAssets(data: Awaited<ReturnType<typeof getGithubData>>['data'], assets: Asset[]) {
  return parseAcademicArchive({ ...data, assets });
}

async function rollbackCreatedFile(config: ServerConfig, path: string, sha: string) {
  try {
    await deleteGithubAsset(config, path, sha, 'Roll back incomplete academic file upload');
  } catch {
    console.error(JSON.stringify({ event: 'asset_upload_rollback_failed', path }));
  }
}

async function createAsset(request: VercelRequest, config: ServerConfig) {
  requireBinaryContentType(request);
  const metadata = parseHeaderMetadata(request);
  assertKeys(metadata, ['activityId', 'name', 'order', 'visibility']);
  const name = fileName(metadata.name);
  const type = fileType(name);
  const activityId = activityValue(metadata.activityId);
  const order = orderValue(metadata.order);
  const visibility = visibilityValue(metadata.visibility);
  const content = await readBinaryBody(request);
  const current = await getGithubData(config);
  if (!(current.data.activities ?? []).some((activity) => activity.id === activityId)) {
    throw new ApiError(400, 'INVALID_ACTIVITY_ID', 'The selected activity does not exist.');
  }

  const id = randomUUID();
  const asset: Asset = { id, activityId, name, type, path: canonicalPath(id, type), order, visibility };
  const nextData = persistAssets(current.data, [...(current.data.assets ?? []), asset]);
  const file = await putGithubAsset(config, checkedAssetPath(asset), content, undefined, `Upload academic asset ${id}`);
  try {
    const result = await updateGithubData(config, nextData, current.sha, 'Add academic file asset');
    return { asset, contentSha: result.contentSha };
  } catch (error) {
    await rollbackCreatedFile(config, asset.path, file.sha);
    throw error;
  }
}

async function replaceAsset(request: VercelRequest, config: ServerConfig) {
  requireBinaryContentType(request);
  const metadata = parseHeaderMetadata(request);
  assertKeys(metadata, ['assetId', 'filename']);
  if (typeof metadata.assetId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(metadata.assetId)) {
    throw new ApiError(400, 'INVALID_ASSET_ID', 'The asset identifier is invalid.');
  }
  const type = fileType(fileName(metadata.filename));
  const content = await readBinaryBody(request);
  const current = await getGithubData(config);
  const assets = current.data.assets ?? [];
  const previousAsset = assets.find((asset) => asset.id === metadata.assetId);
  if (!previousAsset) throw new ApiError(404, 'ASSET_NOT_FOUND', 'The requested asset was not found.');
  const oldPath = checkedAssetPath(previousAsset);
  const oldFile = await getGithubAsset(config, oldPath);
  const nextAsset: Asset = { ...previousAsset, type, path: canonicalPath(previousAsset.id, type) };
  const nextPath = checkedAssetPath(nextAsset);

  if (nextPath === oldPath) {
    await putGithubAsset(config, oldPath, content, oldFile.sha, `Replace academic asset ${previousAsset.id}`);
    return { asset: nextAsset, contentSha: current.sha, cleanupPending: false };
  }

  const newFile = await putGithubAsset(config, nextPath, content, undefined, `Replace academic asset ${previousAsset.id}`);
  let result: { contentSha: string };
  try {
    result = await updateGithubData(config, persistAssets(current.data, assets.map((asset) => asset.id === nextAsset.id ? nextAsset : asset)), current.sha, 'Update academic file asset path');
  } catch (error) {
    await rollbackCreatedFile(config, nextPath, newFile.sha);
    throw error;
  }

  let cleanupPending = false;
  try {
    await deleteGithubAsset(config, oldPath, oldFile.sha, `Remove replaced academic asset ${previousAsset.id}`);
  } catch {
    cleanupPending = true;
    console.error(JSON.stringify({ event: 'asset_replace_cleanup_pending', assetId: previousAsset.id, path: oldPath }));
  }
  return { asset: nextAsset, contentSha: result.contentSha, cleanupPending };
}

async function updateAssetMetadata(request: VercelRequest, config: ServerConfig) {
  requireJsonContentType(request);
  const body = requireRecord(await readJsonBody(request));
  assertKeys(body, ['id', 'activityId', 'name', 'order', 'visibility']);
  if (typeof body.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.id)) {
    throw new ApiError(400, 'INVALID_ASSET_ID', 'The asset identifier is invalid.');
  }
  const current = await getGithubData(config);
  const assets = current.data.assets ?? [];
  const existing = assets.find((asset) => asset.id === body.id);
  if (!existing) throw new ApiError(404, 'ASSET_NOT_FOUND', 'The requested asset was not found.');
  const asset: Asset = {
    ...existing,
    activityId: activityValue(body.activityId),
    name: fileName(body.name),
    order: orderValue(body.order),
    visibility: visibilityValue(body.visibility),
  };
  const data = persistAssets(current.data, assets.map((item) => item.id === asset.id ? asset : item));
  const result = await updateGithubData(config, data, current.sha, 'Update academic file metadata');
  return { asset, contentSha: result.contentSha };
}

async function deleteAsset(request: VercelRequest, config: ServerConfig) {
  requireJsonContentType(request);
  const body = requireRecord(await readJsonBody(request));
  assertKeys(body, ['id']);
  if (typeof body.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.id)) {
    throw new ApiError(400, 'INVALID_ASSET_ID', 'The asset identifier is invalid.');
  }
  const current = await getGithubData(config);
  const assets = current.data.assets ?? [];
  const asset = assets.find((item) => item.id === body.id);
  if (!asset) throw new ApiError(404, 'ASSET_NOT_FOUND', 'The requested asset was not found.');
  const path = checkedAssetPath(asset);
  const file = await getGithubAsset(config, path);
  const data = persistAssets(current.data, assets.filter((item) => item.id !== asset.id));
  const result = await updateGithubData(config, data, current.sha, 'Delete academic file asset metadata');
  try {
    await deleteGithubAsset(config, path, file.sha, `Delete academic file ${asset.id}`);
  } catch (error) {
    try {
      const latest = await getGithubData(config);
      const restoredAssets = latest.data.assets ?? [];
      if (!restoredAssets.some((item) => item.id === asset.id)) {
        const restoredData = persistAssets(latest.data, [...restoredAssets, asset]);
        await updateGithubData(config, restoredData, latest.sha, 'Restore academic file metadata after delete failure');
      }
    } catch {
      console.error(JSON.stringify({ event: 'asset_delete_rollback_failed', assetId: asset.id, path }));
      throw new ApiError(502, 'ASSET_DELETE_INCOMPLETE', 'The file could not be deleted and metadata restoration needs administrator attention.');
    }
    throw error;
  }
  return { id: asset.id, contentSha: result.contentSha };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method ?? '')) {
    response.setHeader('Allow', 'POST, PUT, PATCH, DELETE');
    return sendFailure(response, new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'));
  }

  let serverConfig: ServerConfig | undefined;
  try {
    serverConfig = getServerConfig();
    getAdminAuthContext(request, response, serverConfig);
    requireSameOrigin(request);

    const result = request.method === 'POST'
      ? await createAsset(request, serverConfig)
      : request.method === 'PUT'
        ? await replaceAsset(request, serverConfig)
        : request.method === 'PATCH'
          ? await updateAssetMetadata(request, serverConfig)
          : await deleteAsset(request, serverConfig);
    return sendSuccess(response, result);
  } catch (error) {
    return sendAdminFailure(response, error, serverConfig);
  }
}
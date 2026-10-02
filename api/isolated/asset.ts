import type { VercelRequest, VercelResponse } from '../_lib/platform.ts';
import { getServerConfig, type ServerConfig } from '../_lib/config.ts';
import { ApiError } from '../_lib/errors.ts';
import { getGithubAsset, getGithubData } from '../_lib/github.ts';
import { resolveIsolatedScope } from '../_lib/isolated-links.ts';
import { sendFailure } from '../_lib/http.ts';

const CONTENT_TYPES = {
  PDF: 'application/pdf',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ZIP: 'application/zip',
  CODE: 'text/plain; charset=utf-8',
} as const;

function unavailable(): never {
  throw new ApiError(404, 'ISOLATED_ASSET_UNAVAILABLE', 'This isolated asset is unavailable.');
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendFailure(response, new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'));
  }

  let serverConfig: ServerConfig | undefined;
  try {
    serverConfig = getServerConfig();
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const tokens = requestUrl.searchParams.getAll('token');
    const assetIds = requestUrl.searchParams.getAll('assetId');
    const unsupportedParameter = [...requestUrl.searchParams.keys()].some((key) => key !== 'token' && key !== 'assetId');
    if (
      unsupportedParameter
      || tokens.length !== 1
      || tokens[0]!.length > 128
      || assetIds.length !== 1
      || !/^[A-Za-z0-9_-]{1,128}$/.test(assetIds[0]!)
    ) {
      return unavailable();
    }

    const { data } = await getGithubData(serverConfig);
    const scope = resolveIsolatedScope(data, tokens[0]!);
    if (!scope.assets.some((item) => item.id === assetIds[0])) return unavailable();
    const asset = data.assets?.find((item) => item.id === assetIds[0]);
    if (!asset) return unavailable();

    const { content } = await getGithubAsset(serverConfig, asset.path);
    response.status(200);
    response.setHeader('Content-Type', CONTENT_TYPES[asset.type]);
    response.setHeader('Content-Length', String(content.byteLength));
    response.setHeader('Content-Disposition', asset.type === 'PDF' || asset.type === 'CODE' ? 'inline' : 'attachment');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    return response.end(content);
  } catch (error) {
    return sendFailure(response, error);
  }
}
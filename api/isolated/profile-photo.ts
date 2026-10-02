import type { VercelRequest, VercelResponse } from '../_lib/platform.ts';
import { getServerConfig, type ServerConfig } from '../_lib/config.ts';
import { ApiError } from '../_lib/errors.ts';
import { getGithubAsset, getGithubData } from '../_lib/github.ts';
import { resolveIsolatedScope } from '../_lib/isolated-links.ts';
import { sendFailure } from '../_lib/http.ts';

const CONTENT_TYPES = { JPEG: 'image/jpeg', PNG: 'image/png', WEBP: 'image/webp' } as const;

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendFailure(response, new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'));
  }
  let config: ServerConfig | undefined;
  try {
    config = getServerConfig();
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const tokens = requestUrl.searchParams.getAll('token');
    if ([...requestUrl.searchParams.keys()].some((key) => key !== 'token') || tokens.length !== 1 || tokens[0]!.length > 128) {
      throw new ApiError(404, 'ISOLATED_LINK_UNAVAILABLE', 'This isolated link is unavailable.');
    }
    const { data } = await getGithubData(config);
    resolveIsolatedScope(data, tokens[0]!);
    const photo = data.profile?.photo;
    if (!photo) throw new ApiError(404, 'PROFILE_PHOTO_NOT_FOUND', 'No profile photo is configured.');
    const { content } = await getGithubAsset(config, photo.path);
    response.status(200);
    response.setHeader('Content-Type', CONTENT_TYPES[photo.type]);
    response.setHeader('Content-Length', String(content.byteLength));
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    return response.end(content);
  } catch (error) {
    return sendFailure(response, error);
  }
}
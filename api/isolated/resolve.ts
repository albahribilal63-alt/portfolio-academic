import type { VercelRequest, VercelResponse } from '../_lib/platform.ts';
import { getServerConfig, type ServerConfig } from '../_lib/config.ts';
import { ApiError } from '../_lib/errors.ts';
import { getGithubData } from '../_lib/github.ts';
import { resolveIsolatedScope } from '../_lib/isolated-links.ts';
import { sendFailure, sendSuccess } from '../_lib/http.ts';

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
    if (tokens.length !== 1 || tokens[0]!.length > 128) {
      throw new ApiError(404, 'ISOLATED_LINK_UNAVAILABLE', 'This isolated link is unavailable.');
    }
    const { data } = await getGithubData(serverConfig);
    const scope = resolveIsolatedScope(data, tokens[0]!);
    return sendSuccess(response, { scope });
  } catch (error) {
    return sendFailure(response, error);
  }
}
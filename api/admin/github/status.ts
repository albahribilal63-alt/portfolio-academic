import type { VercelRequest, VercelResponse } from '../../_lib/platform.ts';
import { getAdminAuthContext, sendAdminFailure } from '../../_lib/admin-session.ts';
import { getServerConfig, type ServerConfig } from '../../_lib/config.ts';
import { configuredRepository, verifyRepositoryWriteAccess } from '../../_lib/github.ts';
import { requireMethod, sendSuccess } from '../../_lib/http.ts';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!requireMethod(request, response, 'GET')) return;

  let serverConfig: ServerConfig | undefined;
  try {
    serverConfig = getServerConfig();
    getAdminAuthContext(request, response, serverConfig);
    await verifyRepositoryWriteAccess(serverConfig);
    return sendSuccess(response, {
      connected: true,
      repository: configuredRepository(serverConfig),
      branch: serverConfig.githubBranch,
      dataPath: serverConfig.githubDataPath,
    });
  } catch (error) {
    return sendAdminFailure(response, error, serverConfig);
  }
}
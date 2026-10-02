import type { VercelRequest, VercelResponse } from '../../_lib/platform.ts';
import { expireCookieForEnvironment, isLocalAdminDevelopmentRequest, getAdminAuthContext, sendAdminFailure } from '../../_lib/admin-session.ts';
import { getServerConfig, type ServerConfig } from '../../_lib/config.ts';
import { requireMethod, sendSuccess } from '../../_lib/http.ts';
import { configuredRepository } from '../../_lib/github.ts';
import { isApiError } from '../../_lib/errors.ts';
import { setPrivateResponseHeaders } from '../../_lib/http.ts';
import { hasAdminSessionCookie } from '../../_lib/session.ts';

function sendUnauthenticated(response: VercelResponse) {
  setPrivateResponseHeaders(response);
  return response.status(401).json({
    success: false,
    authenticated: false,
    developmentBypass: false,
    mode: 'unauthenticated',
  });
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!requireMethod(request, response, 'GET')) return;

  let serverConfig: ServerConfig | undefined;
  try {
    if (isLocalAdminDevelopmentRequest(request)) {
      return sendSuccess(response, {
        authenticated: true,
        developmentBypass: true,
        mode: 'local-development',
      });
    }

    if (!hasAdminSessionCookie(request)) {
      expireCookieForEnvironment(response);
      return sendUnauthenticated(response);
    }

    serverConfig = getServerConfig();
    const authContext = getAdminAuthContext(request, response, serverConfig);
    if (authContext.mode === 'local-development') {
      return sendSuccess(response, {
        authenticated: true,
        developmentBypass: true,
        mode: 'local-development',
      });
    }
    return sendSuccess(response, {
      authenticated: true,
      developmentBypass: false,
      mode: 'authenticated-session',
      adminEmail: authContext.session.adminEmail,
      repository: configuredRepository(serverConfig),
    });
  } catch (error) {
    if (isApiError(error) && error.status === 401) {
      return sendUnauthenticated(response);
    }
    return sendAdminFailure(response, error, serverConfig);
  }
}
import type { VercelRequest, VercelResponse } from './platform.ts';
import { isAdminLocalBypassEnabled, isSecureDeployment, type ServerConfig } from './config.ts';
import { clearSessionCookie, readAdminSession, type AdminSession } from './session.ts';
import { ApiError, isApiError } from './errors.ts';
import { sendFailure } from './http.ts';

export type AdminAuthContext =
  | {
    mode: 'local-development';
    authenticated: true;
    admin: true;
    developmentBypass: true;
    identity: 'local-development-admin';
  }
  | {
    mode: 'authenticated-session';
    authenticated: true;
    admin: true;
    developmentBypass: false;
    session: AdminSession;
  };

function isLocalHost(hostHeader: string | string[] | undefined) {
  if (Array.isArray(hostHeader) && hostHeader.length !== 1) return false;
  const host = (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader)?.trim();
  if (!host || /[\s,@/?#]/.test(host)) return false;
  if (host === '::1') return true;

  const ipv6Match = host.match(/^\[([0-9a-fA-F:.]+)\](?::([0-9]{1,5}))?$/);
  if (ipv6Match) return ipv6Match[1]?.toLowerCase() === '::1';

  const hostnameMatch = host.match(/^([^:\[\]]+)(?::([0-9]{1,5}))?$/);
  const hostname = hostnameMatch?.[1]?.toLowerCase();
  if (!hostnameMatch) return false;
  const port = hostnameMatch[2];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65_535)) return false;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function isLocalAdminDevelopmentRequest(request: VercelRequest) {
  const vercelEnvironment = process.env.VERCEL_ENV;
  const isLocalRuntime = process.env.NODE_ENV === 'development'
    && (vercelEnvironment === undefined || vercelEnvironment === 'development');
  return isLocalRuntime
    && isAdminLocalBypassEnabled()
    && isLocalHost(request.headers.host);
}

export function getAdminAuthContext(
  request: VercelRequest,
  response: VercelResponse,
  config?: ServerConfig,
): AdminAuthContext {
  if (isLocalAdminDevelopmentRequest(request)) {
    return {
      mode: 'local-development',
      authenticated: true,
      admin: true,
      developmentBypass: true,
      identity: 'local-development-admin',
    };
  }

  if (!config) throw new ApiError(503, 'SERVER_CONFIGURATION_ERROR', 'Admin API is not configured.');
  const session = readAdminSession(request, config);
  if (session) {
    return {
      mode: 'authenticated-session',
      authenticated: true,
      admin: true,
      developmentBypass: false,
      session,
    };
  }
  clearSessionCookie(response, config);
  throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
}

export function sendAdminFailure(response: VercelResponse, error: unknown, config?: ServerConfig) {
  if (config && isApiError(error) && error.code === 'GITHUB_AUTH_FAILED') {
    clearSessionCookie(response, config);
  }
  return sendFailure(response, error);
}

export function expireCookieForEnvironment(response: VercelResponse) {
  clearSessionCookie(response, {
    secureCookies: isSecureDeployment(),
  });
}
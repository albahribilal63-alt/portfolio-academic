import type { VercelRequest, VercelResponse } from '../../_lib/platform.ts';
import { authenticateAdminCredentials, validateAdminGithubAccess } from '../../_lib/admin-auth.ts';
import { getServerConfig } from '../../_lib/config.ts';
import { ApiError } from '../../_lib/errors.ts';
import {
  MAX_LOGIN_BODY_BYTES,
  readJsonBody,
  requireJsonContentType,
  requireMethod,
  requireRecord,
  requireSameOrigin,
  sendFailure,
  sendSuccess,
} from '../../_lib/http.ts';
import { createSessionCookie } from '../../_lib/session.ts';

export const config = { api: { bodyParser: false } };

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!requireMethod(request, response, 'POST')) return;

  try {
    requireSameOrigin(request);
    requireJsonContentType(request);
    const body = requireRecord(await readJsonBody(request, MAX_LOGIN_BODY_BYTES));
    if (Object.keys(body).some((key) => key !== 'email' && key !== 'password')) {
      throw new ApiError(400, 'INVALID_CREDENTIALS', 'Enter a valid email and password.');
    }
    const email = body.email;
    const password = body.password;
    if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 1_024) {
      throw new ApiError(400, 'INVALID_CREDENTIALS', 'Enter a valid email and password.');
    }

    const serverConfig = getServerConfig();
    const adminEmail = authenticateAdminCredentials(email, password);
    await validateAdminGithubAccess(serverConfig);
    createSessionCookie(response, serverConfig, adminEmail);
    return sendSuccess(response, { authenticated: true, adminEmail });
  } catch (error) {
    return sendFailure(response, error);
  }
}
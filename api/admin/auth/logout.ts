import type { VercelRequest, VercelResponse } from '../../_lib/platform.ts';
import { expireCookieForEnvironment } from '../../_lib/admin-session.ts';
import { requireMethod, requireSameOrigin, sendFailure, sendSuccess } from '../../_lib/http.ts';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!requireMethod(request, response, 'POST')) return;

  try {
    requireSameOrigin(request);
    expireCookieForEnvironment(response);
    return sendSuccess(response, { authenticated: false });
  } catch (error) {
    return sendFailure(response, error);
  }
}
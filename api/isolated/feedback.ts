import { z } from 'zod';
import type { VercelRequest, VercelResponse } from '../_lib/platform.ts';
import { getServerConfig, type ServerConfig } from '../_lib/config.ts';
import { ApiError } from '../_lib/errors.ts';
import { getGithubData, updateGithubData } from '../_lib/github.ts';
import { resolveIsolatedLink, resolveIsolatedScope } from '../_lib/isolated-links.ts';
import type { ProfessorFeedback } from '../../src/types/academic.ts';
import {
  MAX_LOGIN_BODY_BYTES,
  readJsonBody,
  requireJsonContentType,
  requireRecord,
  requireSameOrigin,
  sendFailure,
  sendSuccess,
} from '../_lib/http.ts';
import { parseAcademicArchive } from '../_lib/archive-schema.ts';

export const config = { api: { bodyParser: false } };

const feedbackInputSchema = z.object({
  professorName: z.string().trim().min(2).max(120),
  score: z.number().min(0).max(20),
  comments: z.string().trim().max(5_000),
  observations: z.string().trim().max(5_000),
}).strict();

function readFeedbackAccess(request: VercelRequest) {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const tokens = requestUrl.searchParams.getAll('token');
  const activityIds = requestUrl.searchParams.getAll('activityId');
  const unsupportedParameter = [...requestUrl.searchParams.keys()].some((key) => key !== 'token' && key !== 'activityId');
  if (
    unsupportedParameter
    || tokens.length !== 1
    || tokens[0]!.length > 128
    || activityIds.length !== 1
    || !/^[A-Za-z0-9_-]{1,128}$/.test(activityIds[0]!)
  ) {
    throw new ApiError(404, 'ISOLATED_LINK_UNAVAILABLE', 'This isolated link is unavailable.');
  }
  return { token: tokens[0]!, activityId: activityIds[0]! };
}

function feedbackView(feedback: ProfessorFeedback) {
  return {
    professorName: feedback.professorName,
    score: feedback.score,
    comments: feedback.comments,
    observations: feedback.observations,
    submittedAt: feedback.submittedAt,
  };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return sendFailure(response, new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'));
  }

  let serverConfig: ServerConfig | undefined;
  try {
    serverConfig = getServerConfig();
    const { token, activityId } = readFeedbackAccess(request);
    if (request.method === 'POST') {
      requireSameOrigin(request);
      requireJsonContentType(request);
    }

    const current = await getGithubData(serverConfig);
    const link = resolveIsolatedLink(current.data, token);
    const scope = resolveIsolatedScope(current.data, token);
    if (!scope.activities.some((activity) => activity.id === activityId)) {
      throw new ApiError(404, 'ISOLATED_LINK_UNAVAILABLE', 'This isolated link is unavailable.');
    }
    const existing = (current.data.professorFeedback ?? []).find((item) => (
      item.isolatedLinkId === link.id && item.activityId === activityId
    )) ?? null;
    if (request.method === 'GET') return sendSuccess(response, { feedback: existing ? feedbackView(existing) : null });

    const body = requireRecord(await readJsonBody(request, MAX_LOGIN_BODY_BYTES));
    const parsedInput = feedbackInputSchema.safeParse(body);
    if (!parsedInput.success) {
      throw new ApiError(400, 'INVALID_PROFESSOR_FEEDBACK', 'Enter a professor name, a score from 0 to 20, and valid comments or observations.');
    }

    const feedback = {
      isolatedLinkId: link.id,
      activityId,
      ...parsedInput.data,
      submittedAt: new Date().toISOString(),
    };
    const archive = parseAcademicArchive({
      ...current.data,
      professorFeedback: [
        ...(current.data.professorFeedback ?? []).filter((item) => (
          item.isolatedLinkId !== link.id || item.activityId !== activityId
        )),
        feedback,
      ],
    });
    const result = await updateGithubData(serverConfig, archive, current.sha, 'Save isolated professor assessment');
    return sendSuccess(response, { feedback: feedbackView(feedback), contentSha: result.contentSha });
  } catch (error) {
    return sendFailure(response, error);
  }
}
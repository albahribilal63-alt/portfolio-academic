import type { VercelRequest, VercelResponse } from './platform.ts';
import { ApiError, isApiError } from './errors.ts';
import { isSecureDeployment } from './config.ts';
import { MAX_ASSET_FILE_BYTES, MAX_DATA_BODY_BYTES } from './limits.ts';

export { MAX_DATA_BODY_BYTES, MAX_LOGIN_BODY_BYTES } from './limits.ts';

export function setPrivateResponseHeaders(response: VercelResponse) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
}

export function sendSuccess(response: VercelResponse, payload: Record<string, unknown> = {}) {
  setPrivateResponseHeaders(response);
  return response.status(200).json({ success: true, ...payload });
}

export function sendFailure(response: VercelResponse, error: unknown) {
  const apiError = isApiError(error)
    ? error
    : new ApiError(500, 'INTERNAL_ERROR', 'The request could not be completed.');

  setPrivateResponseHeaders(response);
  return response.status(apiError.status).json({
    success: false,
    error: apiError.code,
    message: apiError.safeMessage,
  });
}

export function requireMethod(
  request: VercelRequest,
  response: VercelResponse,
  method: string,
): boolean {
  if (request.method === method) return true;
  response.setHeader('Allow', method);
  sendFailure(response, new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'));
  return false;
}

export function requireJsonContentType(request: VercelRequest) {
  const contentType = request.headers['content-type'];
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  if (value?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.');
  }
}

export async function readJsonBody(request: VercelRequest, limit = MAX_DATA_BODY_BYTES): Promise<unknown> {
  const header = request.headers['content-length'];
  const lengthValue = Array.isArray(header) ? header[0] : header;
  const contentLength = lengthValue === undefined ? undefined : Number(lengthValue);
  if (contentLength !== undefined && (!Number.isFinite(contentLength) || contentLength < 0)) {
    throw new ApiError(400, 'INVALID_CONTENT_LENGTH', 'The request body is invalid.');
  }
  if (contentLength !== undefined && contentLength > limit) {
    throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Academic data payload is too large.');
  }

  if (request.body !== undefined) {
    const body = request.body;
    const isRawBody = typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array;
    const serializedBody = typeof body === 'string'
      ? body
      : isRawBody
        ? Buffer.from(body).toString('utf8')
        : JSON.stringify(body);
    if (Buffer.byteLength(serializedBody) > limit) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Academic data payload is too large.');
    }
    try {
      return isRawBody ? JSON.parse(serializedBody) as unknown : body;
    } catch {
      throw new ApiError(400, 'INVALID_JSON', 'The request body must contain valid JSON.');
    }
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > limit) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Academic data payload is too large.');
    }
    chunks.push(Uint8Array.from(buffer));
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', 'The request body must contain valid JSON.');
  }
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function requireSameOrigin(request: VercelRequest) {
  const originHeader = firstHeaderValue(request.headers.origin);
  const host = firstHeaderValue(request.headers['x-forwarded-host']) ?? firstHeaderValue(request.headers.host);
  const forwardedProtocol = firstHeaderValue(request.headers['x-forwarded-proto']);
  const protocol = forwardedProtocol?.split(',')[0]?.trim()
    ?? (isSecureDeployment() ? 'https' : 'http');

  if (!originHeader || !host) {
    throw new ApiError(403, 'ORIGIN_REJECTED', 'This request origin is not allowed.');
  }

  try {
    const origin = new URL(originHeader);
    if (origin.host !== host.split(',')[0]?.trim() || origin.protocol !== `${protocol}:`) {
      throw new ApiError(403, 'ORIGIN_REJECTED', 'This request origin is not allowed.');
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(403, 'ORIGIN_REJECTED', 'This request origin is not allowed.');
  }
}

export function requireRecord(value: unknown, code = 'INVALID_REQUEST'): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError(400, code, 'The request body is invalid.');
  }
  return value as Record<string, unknown>;
}

export async function readBinaryBody(request: VercelRequest): Promise<Buffer> {
  const header = request.headers['content-length'];
  const lengthValue = Array.isArray(header) ? header[0] : header;
  const contentLength = lengthValue === undefined ? undefined : Number(lengthValue);
  if (contentLength !== undefined && (!Number.isFinite(contentLength) || contentLength < 0)) {
    throw new ApiError(400, 'INVALID_CONTENT_LENGTH', 'The uploaded file request is invalid.');
  }
  if (contentLength !== undefined && contentLength > MAX_ASSET_FILE_BYTES) {
    throw new ApiError(413, 'ASSET_TOO_LARGE', 'The file exceeds the supported upload size.');
  }

  if (request.body !== undefined) {
    if (!Buffer.isBuffer(request.body) && !(request.body instanceof Uint8Array)) {
      throw new ApiError(400, 'INVALID_FILE_BODY', 'The uploaded file body is invalid.');
    }
    const bytes = Buffer.from(request.body);
    if (bytes.byteLength > MAX_ASSET_FILE_BYTES) {
      throw new ApiError(413, 'ASSET_TOO_LARGE', 'The file exceeds the supported upload size.');
    }
    if (bytes.byteLength === 0) throw new ApiError(400, 'EMPTY_FILE', 'Choose a non-empty file.');
    return bytes;
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_ASSET_FILE_BYTES) {
      throw new ApiError(413, 'ASSET_TOO_LARGE', 'The file exceeds the supported upload size.');
    }
    chunks.push(bytes);
  }
  if (totalBytes === 0) throw new ApiError(400, 'EMPTY_FILE', 'Choose a non-empty file.');
  return Buffer.concat(chunks, totalBytes);
}
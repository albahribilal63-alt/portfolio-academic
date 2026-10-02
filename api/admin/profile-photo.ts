import { randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_lib/platform.ts';
import { getAdminAuthContext, sendAdminFailure } from '../_lib/admin-session.ts';
import { parseAcademicArchive } from '../_lib/archive-schema.ts';
import { getServerConfig, type ServerConfig } from '../_lib/config.ts';
import { ApiError } from '../_lib/errors.ts';
import { deleteGithubAsset, getGithubAsset, getGithubData, putGithubAsset, updateGithubData } from '../_lib/github.ts';
import { readBinaryBody, requireSameOrigin, sendFailure, sendSuccess } from '../_lib/http.ts';
import { MAX_ASSET_FILE_BYTES } from '../_lib/limits.ts';
import { MAX_PROFILE_PHOTO_BYTES, type ProfilePhoto, type ProfilePhotoType } from '../../src/types/academic.ts';

export const config = { api: { bodyParser: false } };

const PROFILE_PHOTO_ROOT = 'public/storage/profile';
const PHOTO_TYPES: Record<string, ProfilePhotoType> = { jpg: 'JPEG', jpeg: 'JPEG', png: 'PNG', webp: 'WEBP' };
const CONTENT_TYPES: Record<ProfilePhotoType, string> = { JPEG: 'image/jpeg', PNG: 'image/png', WEBP: 'image/webp' };

function headerValue(request: VercelRequest, name: string) {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function imageType(fileName: string): ProfilePhotoType {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  const type = PHOTO_TYPES[extension];
  if (!type) throw new ApiError(415, 'UNSUPPORTED_PROFILE_PHOTO', 'Choose a JPEG, PNG, or WebP image.');
  return type;
}

function assertImageSignature(content: Buffer, type: ProfilePhotoType) {
  const valid = type === 'JPEG'
    ? content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff
    : type === 'PNG'
      ? content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : content.length >= 12 && content.toString('ascii', 0, 4) === 'RIFF' && content.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw new ApiError(415, 'INVALID_PROFILE_PHOTO', 'The selected file does not match its image type.');
}

function profilePhotoPath(id: string, type: ProfilePhotoType) {
  const extension = type === 'JPEG' ? 'jpg' : type.toLowerCase();
  return `${PROFILE_PHOTO_ROOT}/${id}.${extension}`;
}

function sendPhoto(response: VercelResponse, photo: ProfilePhoto, content: Buffer) {
  response.status(200);
  response.setHeader('Content-Type', CONTENT_TYPES[photo.type]);
  response.setHeader('Content-Length', String(content.byteLength));
  response.setHeader('Content-Disposition', 'inline');
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  return response.end(content);
}

async function uploadPhoto(request: VercelRequest, config: ServerConfig) {
  requireSameOrigin(request);
  if (headerValue(request, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/octet-stream') {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Upload the profile image as application/octet-stream.');
  }
  const submittedName = headerValue(request, 'x-profile-photo-name');
  if (!submittedName || submittedName.length > 255 || /[\\/\u0000-\u001f\u007f]/.test(submittedName)) {
    throw new ApiError(400, 'INVALID_PROFILE_PHOTO_NAME', 'The profile image name is invalid.');
  }
  const type = imageType(submittedName);
  const content = await readBinaryBody(request);
  if (content.byteLength > MAX_PROFILE_PHOTO_BYTES || content.byteLength > MAX_ASSET_FILE_BYTES) {
    throw new ApiError(413, 'PROFILE_PHOTO_TOO_LARGE', 'The profile image exceeds the supported size of 700 KB.');
  }
  assertImageSignature(content, type);

  const current = await getGithubData(config);
  const id = randomUUID();
  const photo: ProfilePhoto = { id, path: profilePhotoPath(id, type), type };
  const previousPhoto = current.data.profile?.photo;
  const previousFile = previousPhoto ? await getGithubAsset(config, previousPhoto.path) : undefined;
  const createdFile = await putGithubAsset(config, photo.path, content, undefined, 'Upload academic profile photo');
  const profile = { ...current.data.profile, photo };
  const nextData = parseAcademicArchive({ ...current.data, profile });
  let result: { contentSha: string };
  try {
    result = await updateGithubData(config, nextData, current.sha, 'Update academic profile photo');
  } catch (error) {
    try {
      await deleteGithubAsset(config, photo.path, createdFile.sha, 'Roll back incomplete profile photo upload');
    } catch {
      console.error(JSON.stringify({ event: 'profile_photo_rollback_failed', photoId: id }));
    }
    throw error;
  }

  let cleanupPending = false;
  if (previousPhoto && previousFile) {
    try {
      await deleteGithubAsset(config, previousPhoto.path, previousFile.sha, 'Remove replaced academic profile photo');
    } catch {
      cleanupPending = true;
      console.error(JSON.stringify({ event: 'profile_photo_cleanup_pending', photoId: previousPhoto.id }));
    }
  }
  return { photo, contentSha: result.contentSha, cleanupPending };
}

async function removePhoto(config: ServerConfig) {
  const current = await getGithubData(config);
  const photo = current.data.profile?.photo;
  if (!photo) return { photo: null, contentSha: current.sha };
  const stored = await getGithubAsset(config, photo.path);
  const profile = { ...current.data.profile };
  delete profile.photo;
  const nextData = parseAcademicArchive({ ...current.data, profile });
  const result = await updateGithubData(config, nextData, current.sha, 'Remove academic profile photo');
  let cleanupPending = false;
  try {
    await deleteGithubAsset(config, photo.path, stored.sha, 'Delete academic profile photo');
  } catch {
    cleanupPending = true;
    console.error(JSON.stringify({ event: 'profile_photo_cleanup_pending', photoId: photo.id }));
  }
  return { photo: null, contentSha: result.contentSha, cleanupPending };
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!['GET', 'POST', 'DELETE'].includes(request.method ?? '')) {
    response.setHeader('Allow', 'GET, POST, DELETE');
    return sendFailure(response, new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.'));
  }
  let config: ServerConfig | undefined;
  try {
    config = getServerConfig();
    getAdminAuthContext(request, response, config);
    if (request.method === 'GET') {
      const { data } = await getGithubData(config);
      const photo = data.profile?.photo;
      if (!photo) throw new ApiError(404, 'PROFILE_PHOTO_NOT_FOUND', 'No profile photo is configured.');
      const { content } = await getGithubAsset(config, photo.path);
      return sendPhoto(response, photo, content);
    }
    if (request.method === 'POST') return sendSuccess(response, await uploadPhoto(request, config));
    return sendSuccess(response, await removePhoto(config));
  } catch (error) {
    return sendAdminFailure(response, error, config);
  }
}
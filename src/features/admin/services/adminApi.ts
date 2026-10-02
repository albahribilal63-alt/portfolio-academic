import type { AcademicArchive } from '../../../types/academic';
import type {
  AdminApiError,
  AdminAssetResponse,
  AdminAuthResponse,
  AdminDataResponse,
  AdminDataUpdateResponse,
  AdminLogoutResponse,
  AdminProfilePhotoResponse,
  AdminSessionResponse,
  GithubStatusResponse,
  IsolatedLinkTokenResponse,
  IsolatedLinkUrlsResponse,
  PrimaryProfessorLinksResponse,
} from '../types/api';

export class AdminApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'AdminApiRequestError';
  }
}

const inFlightRequests = new Map<string, Promise<unknown>>();

function singleFlight<T>(key: string, operation: () => Promise<T>) {
  const existing = inFlightRequests.get(key);
  if (existing) return existing as Promise<T>;

  const pending = operation();
  inFlightRequests.set(key, pending);
  const clear = () => {
    if (inFlightRequests.get(key) === pending) inFlightRequests.delete(key);
  };
  pending.then(clear, clear);
  return pending;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new AdminApiRequestError('Admin API is unavailable.', 0, 'API_UNAVAILABLE');
  }

  const contentType = response.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
  const isJsonContentType = contentType === 'application/json' || contentType?.endsWith('+json') === true;
  if (!isJsonContentType) {
    throw new AdminApiRequestError('Admin API returned a non-JSON response. Check the serverless API runtime.', response.status, 'INVALID_CONTENT_TYPE');
  }

  let payload: unknown;
  try {
    payload = await response.json() as unknown;
  } catch {
    throw new AdminApiRequestError('Admin API returned an invalid response.', response.status, 'INVALID_RESPONSE');
  }

  if (!response.ok) {
    const errorPayload = payload as Partial<AdminApiError>;
    throw new AdminApiRequestError(
      typeof errorPayload.message === 'string' ? errorPayload.message : 'The request could not be completed.',
      response.status,
      typeof errorPayload.error === 'string' ? errorPayload.error : 'REQUEST_FAILED',
    );
  }

  return payload as T;
}

export const adminApi = {
  login(email: string, password: string) {
    return request<AdminAuthResponse>('/api/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },
  getSession() {
    return singleFlight('admin-session', () => request<AdminSessionResponse>('/api/admin/auth/session'));
  },
  logout() {
    return request<AdminLogoutResponse>('/api/admin/auth/logout', { method: 'POST' });
  },
  getGithubStatus() {
    return singleFlight('admin-github-status', () => request<GithubStatusResponse>('/api/admin/github/status'));
  },
  getData() {
    return request<AdminDataResponse>('/api/admin/data');
  },
  async updateData(data: AcademicArchive, sha: string, message?: string) {
    const result = await request<AdminDataUpdateResponse>('/api/admin/data', {
      method: 'PUT',
      body: JSON.stringify({ data, sha, ...(message === undefined ? {} : { message }) }),
    });
    if (
      result.success !== true
      || typeof result.data !== 'object'
      || result.data === null
      || !Array.isArray(result.links)
      || result.links.some((link) => !link || typeof link.id !== 'string' || typeof link.token !== 'string')
      || !/^[a-f0-9]{40}$/i.test(result.contentSha)
      || !/^[a-f0-9]{40}$/i.test(result.commitSha)
    ) {
      throw new AdminApiRequestError('The Admin API did not confirm the data update.', 502, 'INVALID_UPDATE_RESPONSE');
    }
    return result;
  },
  uploadAsset(file: File, metadata: { activityId: string; name: string; order: number; visibility: string }) {
    return request<AdminAssetResponse>('/api/admin/assets', {
      method: 'POST',
      body: file,
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Asset-Metadata': JSON.stringify(metadata),
      },
    });
  },
  replaceAsset(assetId: string, file: File) {
    return request<AdminAssetResponse>('/api/admin/assets', {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Asset-Metadata': JSON.stringify({ assetId, filename: file.name }),
      },
    });
  },
  updateAssetMetadata(metadata: { id: string; activityId: string; name: string; order: number; visibility: string }) {
    return request<AdminAssetResponse>('/api/admin/assets', {
      method: 'PATCH',
      body: JSON.stringify(metadata),
    });
  },
  deleteAsset(id: string) {
    return request<AdminAssetResponse>('/api/admin/assets', {
      method: 'DELETE',
      body: JSON.stringify({ id }),
    });
  },
  uploadProfilePhoto(file: File) {
    return request<AdminProfilePhotoResponse>('/api/admin/profile-photo', {
      method: 'POST',
      body: file,
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Profile-Photo-Name': file.name,
      },
    });
  },
  deleteProfilePhoto() {
    return request<AdminProfilePhotoResponse>('/api/admin/profile-photo', { method: 'DELETE', body: JSON.stringify({}) });
  },
  issueIsolatedLinkToken(input: { id?: string; scopeType?: 'module' | 'activity'; scopeId?: string; expiresAt?: string | null }) {
    return request<IsolatedLinkTokenResponse>('/api/admin/isolated-link-token', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  getIsolatedLinkUrls() {
    return request<IsolatedLinkUrlsResponse>('/api/admin/isolated-link-token');
  },
  provisionPrimaryProfessorLinks() {
    return request<PrimaryProfessorLinksResponse>('/api/admin/isolated-link-token', {
      method: 'POST',
      body: JSON.stringify({ action: 'provision-primary-links' }),
    });
  },
};
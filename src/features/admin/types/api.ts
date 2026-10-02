import type { AcademicArchive, Asset, IsolatedLink, ProfilePhoto } from '../../../types/academic';

export interface AdminApiError {
  success: false;
  error: string;
  message: string;
}

export interface AdminAuthResponse {
  success: true;
  authenticated: true;
  adminEmail: string;
}

export interface AdminSessionResponse {
  success: true;
  authenticated: true;
  mode: 'local-development' | 'authenticated-session';
  developmentBypass: boolean;
  adminEmail?: string;
  repository?: string;
}

export interface AdminLogoutResponse {
  success: true;
  authenticated: false;
}

export interface GithubStatusResponse {
  success: true;
  connected: true;
  repository: string;
  branch: string;
  dataPath: string;
}

export interface AdminDataResponse {
  success: true;
  data: AcademicArchive;
  sha: string;
  path: string;
  branch: string;
}

export interface AdminDataUpdateResponse {
  success: true;
  data: AcademicArchive;
  links: Array<{ id: string; token: string }>;
  contentSha: string;
  commitSha: string;
}

export interface AdminAssetResponse {
  success: true;
  asset?: Asset;
  id?: string;
  contentSha: string;
  cleanupPending?: boolean;
}

export interface AdminProfilePhotoResponse {
  success: true;
  photo: ProfilePhoto | null;
  contentSha?: string;
  cleanupPending?: boolean;
}

export interface IsolatedLinkTokenResponse {
  success: true;
  link: IsolatedLink;
  token: string;
}

export interface IsolatedLinkUrlsResponse {
  success: true;
  links: Array<{ id: string; token: string }>;
}

export interface PrimaryProfessorLinksResponse {
  success: true;
  data: AcademicArchive;
  sha: string;
  links: Array<{ id: string; token: string }>;
}

export type AdminApiSuccess =
  | AdminAuthResponse
  | AdminSessionResponse
  | AdminLogoutResponse
  | GithubStatusResponse
  | AdminDataResponse
  | AdminDataUpdateResponse;
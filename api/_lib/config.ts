import { ApiError } from './errors.ts';

export interface ServerConfig {
  githubPat: string;
  githubOwner: string;
  githubRepo: string;
  githubBranch: string;
  githubDataPath: string;
  adminSessionSecret: string;
  adminLocalBypass: boolean;
  secureCookies: boolean;
}

export function isSecureDeployment() {
  return process.env.NODE_ENV === 'production'
    || process.env.VERCEL_ENV === 'preview'
    || process.env.VERCEL_ENV === 'production';
}

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name];
  if (!value) {
    if (name === 'GITHUB_PAT' && process.env.NODE_ENV === 'development' && process.env.ADMIN_LOCAL_BYPASS === 'true') {
      throw new ApiError(503, 'GITHUB_CREDENTIALS_NOT_CONFIGURED', 'GitHub credentials are not configured for local development.');
    }
    throw new ApiError(503, 'SERVER_CONFIGURATION_ERROR', 'Admin API is not configured.');
  }
  return value;
}

export function isAdminLocalBypassEnabled() {
  return process.env.ADMIN_LOCAL_BYPASS === 'true';
}

function validateDataPath(path: string): string {
  const segments = path.split('/');
  if (
    path.length > 512
    || path.startsWith('/')
    || path.includes('\\')
    || segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new ApiError(503, 'SERVER_CONFIGURATION_ERROR', 'Admin API is not configured.');
  }
  return path;
}

export function getServerConfig(): ServerConfig {
  const githubPat = requiredEnvironmentValue('GITHUB_PAT');
  const githubOwner = requiredEnvironmentValue('GITHUB_OWNER');
  const githubRepo = requiredEnvironmentValue('GITHUB_REPO');
  const githubBranch = requiredEnvironmentValue('GITHUB_BRANCH');
  const githubDataPath = validateDataPath(requiredEnvironmentValue('GITHUB_DATA_PATH'));
  const adminSessionSecret = requiredEnvironmentValue('ADMIN_SESSION_SECRET');

  if (!/^[A-Za-z0-9-]{1,100}$/.test(githubOwner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(githubRepo)) {
    throw new ApiError(503, 'SERVER_CONFIGURATION_ERROR', 'Admin API is not configured.');
  }
  if (Buffer.byteLength(adminSessionSecret, 'utf8') < 32 || /^(.)\1{31,}$/.test(adminSessionSecret)) {
    throw new ApiError(503, 'SERVER_CONFIGURATION_ERROR', 'Admin API is not configured.');
  }

  return {
    githubPat,
    githubOwner,
    githubRepo,
    githubBranch,
    githubDataPath,
    adminSessionSecret,
    adminLocalBypass: isAdminLocalBypassEnabled(),
    secureCookies: isSecureDeployment(),
  };
}
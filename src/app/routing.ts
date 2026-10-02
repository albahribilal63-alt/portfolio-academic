export const ADMIN_ROUTE = '/admin';
export const ADMIN_LOGIN_ROUTE = `${ADMIN_ROUTE}/login`;
export const LEGACY_ADMIN_ROUTE = '/admin-portal-x97';
export const ADMIN_PROFILE_ROUTE = `${ADMIN_ROUTE}/profile`;
export const ADMIN_YEARS_ROUTE = `${ADMIN_ROUTE}/years`;
export const ADMIN_MODULES_ROUTE = `${ADMIN_ROUTE}/modules`;
export const ADMIN_ACTIVITIES_ROUTE = `${ADMIN_ROUTE}/activities`;
export const ADMIN_ASSETS_ROUTE = `${ADMIN_ROUTE}/files`;
export const ADMIN_ISOLATED_LINKS_ROUTE = `${ADMIN_ROUTE}/isolated-links`;
export const ISOLATED_ASSESSMENT_ROUTE_PREFIX = '/assessment';
const ISOLATED_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isolatedAssetPath(token: string, assetId: string) {
  if (!ISOLATED_TOKEN_PATTERN.test(token) || !/^[A-Za-z0-9_-]{1,128}$/.test(assetId)) {
    throw new Error('Invalid isolated asset reference.');
  }
  const query = new URLSearchParams({ token, assetId });
  return `/api/isolated/asset?${query.toString()}`;
}

export function isolatedProfilePhotoPath(token: string) {
  if (!ISOLATED_TOKEN_PATTERN.test(token)) throw new Error('Invalid isolated token.');
  return `/api/isolated/profile-photo?${new URLSearchParams({ token }).toString()}`;
}

export function isolatedAssessmentPath(token: string) {
  if (!ISOLATED_TOKEN_PATTERN.test(token)) throw new Error('Invalid isolated token.');
  return `${ISOLATED_ASSESSMENT_ROUTE_PREFIX}/${token}`;
}

export function isolatedAssessmentUrl(token: string, origin: string) {
  return new URL(isolatedAssessmentPath(token), origin).toString();
}

export function normalizeAdminPathname(pathname: string) {
  if (pathname === LEGACY_ADMIN_ROUTE || pathname.startsWith(`${LEGACY_ADMIN_ROUTE}/`)) {
    return `${ADMIN_ROUTE}${pathname.slice(LEGACY_ADMIN_ROUTE.length)}`;
  }
  return pathname;
}

export type ApplicationMode = 'public' | 'isolated' | 'admin' | 'not-found';

export function resolveApplicationMode(pathname: string, _search: string): ApplicationMode {
  const normalizedPathname = normalizeAdminPathname(pathname);
  if (normalizedPathname === ADMIN_ROUTE || normalizedPathname.startsWith(`${ADMIN_ROUTE}/`)) return 'admin';
  const pathSegments = pathname.split('/');
  if (pathSegments.length === 3 && `/${pathSegments[1]}` === ISOLATED_ASSESSMENT_ROUTE_PREFIX && pathSegments[2]) return 'isolated';
  if (pathname !== '/') return 'not-found';

  return 'public';
}
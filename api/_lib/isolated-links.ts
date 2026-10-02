import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.ts';
import type { ServerConfig } from './config.ts';
import type { AcademicArchive, IsolatedLink, IsolatedScopeType, ProfessorFeedback } from '../../src/types/academic.ts';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const CIPHERTEXT_PATTERN = /^v1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{58})$/;
const TOKEN_AAD = Buffer.from('academic-portfolio-isolated-token:v1', 'utf8');
const TOKEN_KEY_SALT = 'academic-portfolio-isolated-token-key:v1';
let cachedAdminSessionSecret: string | undefined;
let cachedTokenEncryptionKey: Buffer | undefined;

function tokenEncryptionKey(config: ServerConfig) {
  if (!cachedTokenEncryptionKey || cachedAdminSessionSecret !== config.adminSessionSecret) {
    cachedAdminSessionSecret = config.adminSessionSecret;
    cachedTokenEncryptionKey = scryptSync(config.adminSessionSecret, TOKEN_KEY_SALT, 32);
  }
  return cachedTokenEncryptionKey;
}

export function createIsolatedToken() {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: createHash('sha256').update(token, 'utf8').digest('hex'),
  };
}

export function hashIsolatedToken(token: string): string | undefined {
  if (!TOKEN_PATTERN.test(token)) return undefined;
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function findLink(links: IsolatedLink[], tokenHash: string): IsolatedLink | undefined {
  const requestedHash = Buffer.from(tokenHash, 'hex');
  return links.find((link) => {
    if (!HASH_PATTERN.test(link.tokenHash)) return false;
    return timingSafeEqual(Buffer.from(link.tokenHash, 'hex'), requestedHash);
  });
}

function unavailable(): never {
  throw new ApiError(404, 'ISOLATED_LINK_UNAVAILABLE', 'This isolated link is unavailable.');
}

export function resolveIsolatedLink(archive: AcademicArchive, token: string, now = Date.now()) {
  const tokenHash = hashIsolatedToken(token);
  if (!tokenHash) return unavailable();
  const link = findLink(archive.isolatedLinks ?? [], tokenHash);
  if (!link || link.status !== 'active' || (link.expiresAt !== null && Date.parse(link.expiresAt) <= now)) {
    return unavailable();
  }
  return link;
}

function academicIdentity(archive: AcademicArchive) {
  const profile = archive.profile;
  const legacyNameParts = profile?.name?.trim().split(/\s+/).filter(Boolean) ?? [];
  return {
    site: {
      ...(archive.site.title ? { title: archive.site.title } : {}),
      ...(archive.site.description ? { description: archive.site.description } : {}),
    },
    ...(profile ? {
      profile: {
        ...(profile.lastName || legacyNameParts.length > 1 ? { lastName: profile.lastName ?? legacyNameParts.at(-1)! } : {}),
        ...(profile.firstName || legacyNameParts.length > 0 ? { firstName: profile.firstName ?? (legacyNameParts.length > 1 ? legacyNameParts.slice(0, -1).join(' ') : legacyNameParts[0]!) } : {}),
        ...(profile.filiere || profile.program ? { filiere: profile.filiere ?? profile.program } : {}),
        ...(profile.section || profile.branch ? { section: profile.section ?? profile.branch } : {}),
        ...(profile.tdGroup ? { tdGroup: profile.tdGroup } : {}),
        ...(profile.photo ? { photoAvailable: true } : {}),
      },
    } : {}),
  };
}

function projectModule(module: NonNullable<AcademicArchive['modules']>[number]) {
  return {
    id: module.id,
    yearId: module.yearId,
    code: module.code,
    name: module.name,
    ...(module.description ? { description: module.description } : {}),
    order: module.order,
    visibility: module.visibility,
  };
}

function projectActivity(activity: NonNullable<AcademicArchive['activities']>[number]) {
  return {
    id: activity.id,
    moduleId: activity.moduleId,
    title: activity.title,
    ...(activity.description ? { description: activity.description } : {}),
    type: activity.type,
    order: activity.order,
    visibility: activity.visibility,
  };
}

function projectAsset(asset: NonNullable<AcademicArchive['assets']>[number]) {
  return {
    id: asset.id,
    activityId: asset.activityId,
    name: asset.name,
    type: asset.type,
    order: asset.order,
    visibility: asset.visibility,
  };
}

function projectScopedFeedback(archive: AcademicArchive, link: IsolatedLink, activities: { id: string }[]) {
  const feedback = archive.professorFeedback ?? [];
  return Object.fromEntries(activities.map(({ id }) => {
    const item = feedback.find((entry) => entry.isolatedLinkId === link.id && entry.activityId === id);
    return [id, item ? {
      professorName: item.professorName,
      score: item.score,
      comments: item.comments,
      observations: item.observations,
      submittedAt: item.submittedAt,
    } satisfies Pick<ProfessorFeedback, 'professorName' | 'score' | 'comments' | 'observations' | 'submittedAt'> : null];
  }));
}

export function resolveIsolatedScope(
  archive: AcademicArchive,
  token: string,
  now = Date.now(),
) {
  const link = resolveIsolatedLink(archive, token, now);

  const activities = archive.activities ?? [];
  const assets = archive.assets ?? [];
  const modules = archive.modules ?? [];
  if (link.scopeType === 'module') {
    const module = modules.find((item) => item.id === link.scopeId);
    if (!module) return unavailable();
    const year = archive.years.find((item) => item.id === module.yearId);
    if (!year) return unavailable();
    const scopedActivities = activities.filter((activity) => activity.moduleId === module.id);
    const scopedActivityIds = new Set(scopedActivities.map((activity) => activity.id));
    return {
      scopeType: 'module' as const,
      scopeId: module.id,
      ...academicIdentity(archive),
      year: { id: year.id, name: year.name, status: year.status, order: year.order },
      module: projectModule(module),
      activities: scopedActivities.map(projectActivity),
      assets: assets.filter((asset) => scopedActivityIds.has(asset.activityId)).map(projectAsset),
      feedbackByActivity: projectScopedFeedback(archive, link, scopedActivities),
    };
  }

  const activity = activities.find((item) => item.id === link.scopeId);
  if (!activity) return unavailable();
  const module = modules.find((item) => item.id === activity.moduleId);
  if (!module) return unavailable();
  const year = archive.years.find((item) => item.id === module.yearId);
  if (!year) return unavailable();
  return {
    scopeType: 'activity' as const,
    scopeId: activity.id,
    ...academicIdentity(archive),
    year: { id: year.id, name: year.name, status: year.status, order: year.order },
    module: projectModule(module),
    activities: [projectActivity(activity)],
    assets: assets.filter((asset) => asset.activityId === activity.id).map(projectAsset),
    feedbackByActivity: projectScopedFeedback(archive, link, [activity]),
  };
}

export function validateIsolatedScopeType(value: unknown): value is IsolatedScopeType {
  return value === 'module' || value === 'activity';
}

export function encryptIsolatedToken(config: ServerConfig, token: string): string {
  if (!TOKEN_PATTERN.test(token)) throw new ApiError(500, 'TOKEN_GENERATION_FAILED', 'Unable to generate an isolated link.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenEncryptionKey(config), iv);
  cipher.setAAD(TOKEN_AAD);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptIsolatedToken(config: ServerConfig, tokenCiphertext: string): string | undefined {
  const match = CIPHERTEXT_PATTERN.exec(tokenCiphertext);
  if (!match) return undefined;
  try {
    const [, encodedIv, encodedTag, encodedCiphertext] = match;
    const decipher = createDecipheriv('aes-256-gcm', tokenEncryptionKey(config), Buffer.from(encodedIv!, 'base64url'));
    decipher.setAAD(TOKEN_AAD);
    decipher.setAuthTag(Buffer.from(encodedTag!, 'base64url'));
    const token = Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext!, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    return TOKEN_PATTERN.test(token) ? token : undefined;
  } catch {
    return undefined;
  }
}

export function activeIsolatedTokenUrls(links: IsolatedLink[], config: ServerConfig, now = Date.now()) {
  return links.flatMap((link) => {
    if (link.status !== 'active' || (link.expiresAt !== null && Date.parse(link.expiresAt) <= now)) return [];
    const token = decryptIsolatedToken(config, link.tokenCiphertext);
    if (!token || hashIsolatedToken(token) !== link.tokenHash) return [];
    return [{ id: link.id, token }];
  });
}

export function ensurePrimaryProfessorLinks(
  archive: AcademicArchive,
  previous: AcademicArchive,
  config: ServerConfig,
  provisionExistingTargets = true,
) {
  const modules = archive.modules ?? [];
  const activities = archive.activities ?? [];
  const targetExists = (link: IsolatedLink) => link.scopeType === 'module'
    ? modules.some((module) => module.id === link.scopeId)
    : activities.some((activity) => activity.id === link.scopeId);
  const previousPrimary = (previous.isolatedLinks ?? []).filter((link) => (
    link.purpose === 'primary-professor' && targetExists(link)
  ));
  const incomingLinks = archive.isolatedLinks ?? previous.isolatedLinks ?? [];
  const managedIds = new Set(previousPrimary.map((link) => link.id));
  const nextPrimary: IsolatedLink[] = [];

  for (const existing of previousPrimary) {
    const incoming = incomingLinks.find((link) => link.purpose === 'primary-professor' && (
      link.scopeType === existing.scopeType && link.scopeId === existing.scopeId
    ));
    if (incoming && incoming.id !== existing.id) {
      throw new ApiError(400, 'PRIMARY_LINK_IMMUTABLE', 'A primary Professor Link cannot be replaced through an academic data update.');
    }
    const submitted = incomingLinks.find((link) => link.id === existing.id);
    if (submitted && (submitted.scopeType !== existing.scopeType || submitted.scopeId !== existing.scopeId || submitted.purpose !== existing.purpose)) {
      throw new ApiError(400, 'PRIMARY_LINK_IMMUTABLE', 'A primary Professor Link cannot change its target.');
    }
    nextPrimary.push(submitted ? {
      ...existing,
      status: submitted.status,
      expiresAt: submitted.expiresAt,
    } : existing);
  }

  const unrecognizedPrimary = incomingLinks.find((link) => link.purpose === 'primary-professor' && !managedIds.has(link.id));
  if (unrecognizedPrimary) {
    throw new ApiError(400, 'PRIMARY_LINK_SERVER_MANAGED', 'Primary Professor Links are provisioned by the server.');
  }

  const occupiedScopes = new Set(nextPrimary.map((link) => `${link.scopeType}:${link.scopeId}`));
  const createdTokens: Array<{ id: string; token: string }> = [];
  const createFor = (scopeType: IsolatedLink['scopeType'], scopeId: string) => {
    const key = `${scopeType}:${scopeId}`;
    if (occupiedScopes.has(key)) return;
    const { token, tokenHash } = createIsolatedToken();
    const link: IsolatedLink = {
      id: randomUUID(),
      tokenHash,
      tokenCiphertext: encryptIsolatedToken(config, token),
      scopeType,
      scopeId,
      purpose: 'primary-professor',
      status: 'active',
      expiresAt: null,
    };
    nextPrimary.push(link);
    createdTokens.push({ id: link.id, token });
    occupiedScopes.add(key);
  };

  const previousModuleIds = new Set((previous.modules ?? []).map((module) => module.id));
  const previousActivityIds = new Set((previous.activities ?? []).map((activity) => activity.id));
  modules.filter((module) => provisionExistingTargets || !previousModuleIds.has(module.id))
    .forEach((module) => createFor('module', module.id));
  activities.filter((activity) => provisionExistingTargets || !previousActivityIds.has(activity.id))
    .forEach((activity) => createFor('activity', activity.id));

  const isolatedLinks = [
    ...incomingLinks.filter((link) => link.purpose !== 'primary-professor' && targetExists(link)),
    ...nextPrimary,
  ];
  const hasIsolatedLinks = Object.hasOwn(archive, 'isolatedLinks')
    || Object.hasOwn(previous, 'isolatedLinks')
    || isolatedLinks.length > 0;
  return {
    data: { ...archive, ...(hasIsolatedLinks ? { isolatedLinks } : {}) },
    createdTokens,
    changed: createdTokens.length > 0 || nextPrimary.some((link) => {
      const incoming = incomingLinks.find((item) => item.id === link.id);
      return !incoming
        || incoming.scopeType !== link.scopeType
        || incoming.scopeId !== link.scopeId
        || incoming.tokenHash !== link.tokenHash
        || incoming.tokenCiphertext !== link.tokenCiphertext
        || incoming.status !== link.status
        || incoming.expiresAt !== link.expiresAt
        || incoming.purpose !== link.purpose;
    }),
  };
}

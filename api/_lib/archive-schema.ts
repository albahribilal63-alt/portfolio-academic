import { z } from 'zod';
import type { AcademicArchive, AcademicYear } from '../../src/types/academic.ts';
import { ApiError } from './errors.ts';

const orderSchema = z.number().int().min(0).max(1_000_000).optional();
const visibilitySchema = z.enum(['public', 'private', 'unlisted']).optional();
const boundedText = (max: number) => z.string().max(max);

function isSafeAssetUrl(value: string) {
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const siteSchema = z.object({
  title: boundedText(200).optional(),
  description: boundedText(2_000).optional(),
}).passthrough();

const profileSchema = z.object({
  lastName: boundedText(120).optional(),
  firstName: boundedText(120).optional(),
  filiere: boundedText(160).optional(),
  section: boundedText(100).optional(),
  tdGroup: boundedText(100).optional(),
  name: boundedText(120).optional(),
  title: boundedText(200).optional(),
  institution: boundedText(180).optional(),
  biography: boundedText(5_000).optional(),
  cne: boundedText(40).optional(),
  apogee: boundedText(40).optional(),
  program: boundedText(160).optional(),
  branch: boundedText(160).optional(),
  semester: z.enum(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']).optional(),
  photo: z.object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    path: z.string().min(1).max(512),
    type: z.enum(['JPEG', 'PNG', 'WEBP']),
  }).strict().optional(),
}).passthrough();

const profileWriteSchema = profileSchema.extend({
  lastName: z.string().trim().min(2).max(120),
  firstName: z.string().trim().min(2).max(120),
  filiere: z.string().trim().min(2).max(160),
  section: z.string().trim().min(1).max(100),
  tdGroup: z.string().trim().min(1).max(100),
}).passthrough();

const assetSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(300),
  kind: z.enum(['document', 'code', 'image', 'link', 'other']),
  url: z.string().min(1).max(2_048).refine(isSafeAssetUrl),
  mimeType: boundedText(200).optional(),
  sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  order: orderSchema,
  visibility: visibilitySchema,
}).passthrough();

const activitySchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(300),
  description: boundedText(10_000).optional(),
  order: orderSchema,
  visibility: visibilitySchema,
  assets: z.array(assetSchema).max(500),
}).passthrough();

const portfolioActivitySchema = z.object({
  id: z.string().min(1).max(128),
  moduleId: z.string().min(1).max(128),
  title: z.string().trim().min(1).max(300),
  description: boundedText(10_000).optional(),
  type: z.enum(['lesson', 'exercise', 'project', 'quiz', 'lab', 'workshop', 'reading', 'other']),
  order: z.number().int().min(1).max(1_000_000),
  visibility: z.enum(['public', 'private', 'unlisted']),
}).passthrough();

const portfolioAssetSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  activityId: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(255).refine((value) => !/[\\/\u0000-\u001f\u007f]/.test(value)),
  type: z.enum(['PDF', 'DOCX', 'XLSX', 'ZIP', 'CODE']),
  path: z.string().min(1).max(512),
  order: z.number().int().min(1).max(1_000_000),
  visibility: z.enum(['public', 'private', 'unlisted']),
}).passthrough();

const isolatedLinkSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  tokenCiphertext: z.string().regex(/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{58}$/),
  scopeType: z.enum(['module', 'activity']),
  scopeId: z.string().min(1).max(128),
  purpose: z.literal('primary-professor').optional(),
  status: z.enum(['active', 'revoked']),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
}).passthrough();

const professorFeedbackSchema = z.object({
  isolatedLinkId: z.string().min(1).max(128),
  activityId: z.string().min(1).max(128),
  professorName: z.string().trim().min(1).max(120),
  score: z.number().min(0).max(20),
  comments: z.string().max(5_000),
  observations: z.string().max(5_000),
  submittedAt: z.string().datetime({ offset: true }),
}).strict();

const moduleSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(300),
  code: boundedText(100).optional(),
  description: boundedText(10_000).optional(),
  order: orderSchema,
  visibility: visibilitySchema,
  isolatedLink: z.object({
    enabled: z.boolean().optional(),
    scope: boundedText(256).optional(),
  }).passthrough().optional(),
  activities: z.array(activitySchema).max(1_000),
}).passthrough();

const portfolioModuleSchema = z.object({
  id: z.string().min(1).max(128),
  yearId: z.string().min(1).max(128),
  code: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(300),
  description: boundedText(10_000).optional(),
  order: z.number().int().min(1).max(1_000_000),
  visibility: z.enum(['public', 'private', 'unlisted']),
}).passthrough();

const yearSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(4).max(40).refine((value) => value === value.trim()),
  status: z.enum(['previous', 'current', 'upcoming']),
  order: z.number().int().min(1).max(100),
  modules: z.array(moduleSchema).max(500).optional(),
}).passthrough();

function reportDuplicateIds<T extends { id: string }>(
  items: T[],
  path: (string | number)[],
  addIssue: (issue: { code: 'custom'; path: (string | number)[]; message: string }) => void,
) {
  const seen = new Set<string>();
  items.forEach(({ id }, index) => {
    if (seen.has(id)) addIssue({ code: 'custom', path: [...path, index, 'id'], message: 'Duplicate identifier.' });
    seen.add(id);
  });
}

export const academicArchiveSchema = z.object({
  site: siteSchema,
  profile: profileSchema.optional(),
  years: z.array(yearSchema).max(100),
  modules: z.array(portfolioModuleSchema).max(1_000).optional(),
  activities: z.array(portfolioActivitySchema).max(2_000).optional(),
  assets: z.array(portfolioAssetSchema).max(5_000).optional(),
  isolatedLinks: z.array(isolatedLinkSchema).max(2_000).optional(),
  professorFeedback: z.array(professorFeedbackSchema).max(2_000).optional(),
}).passthrough().superRefine((archive, context) => {
  const profilePhoto = archive.profile?.photo;
  if (profilePhoto) {
    const extension = { JPEG: 'jpg', PNG: 'png', WEBP: 'webp' }[profilePhoto.type];
    if (profilePhoto.path !== `public/storage/profile/${profilePhoto.id}.${extension}`) {
      context.addIssue({ code: 'custom', path: ['profile', 'photo', 'path'], message: 'Profile photo path must use the canonical storage directory.' });
    }
  }

  reportDuplicateIds(archive.years, ['years'], (issue) => context.addIssue(issue));

  const normalizedNames = new Set<string>();
  const orders = new Set<number>();
  let currentYearCount = 0;
  archive.years.forEach((year, yearIndex) => {
    const normalizedName = year.name.trim().toLocaleLowerCase('en-US');
    if (normalizedNames.has(normalizedName)) {
      context.addIssue({ code: 'custom', path: ['years', yearIndex, 'name'], message: 'Duplicate academic year name.' });
    }
    normalizedNames.add(normalizedName);
    if (orders.has(year.order)) {
      context.addIssue({ code: 'custom', path: ['years', yearIndex, 'order'], message: 'Duplicate academic year order.' });
    }
    orders.add(year.order);
    if (year.status === 'current') currentYearCount += 1;
  });
  if (currentYearCount > 1) {
    context.addIssue({ code: 'custom', path: ['years'], message: 'Only one academic year may be current.' });
  }
  for (let expectedOrder = 1; expectedOrder <= archive.years.length; expectedOrder += 1) {
    if (!orders.has(expectedOrder)) {
      context.addIssue({ code: 'custom', path: ['years'], message: 'Academic year orders must be contiguous.' });
      break;
    }
  }

  const moduleIds = new Set<string>();
  const yearIds = new Set(archive.years.map((year) => year.id));
  const modules = archive.modules ?? [];
  const activities = archive.activities ?? [];
  reportDuplicateIds(modules, ['modules'], (issue) => context.addIssue(issue));
  const moduleOrdersByYear = new Map<string, Set<number>>();
  modules.forEach((module, moduleIndex) => {
    if (!yearIds.has(module.yearId)) {
      context.addIssue({ code: 'custom', path: ['modules', moduleIndex, 'yearId'], message: 'Module must reference an existing academic year.' });
    }
    const yearOrders = moduleOrdersByYear.get(module.yearId) ?? new Set<number>();
    if (yearOrders.has(module.order)) {
      context.addIssue({ code: 'custom', path: ['modules', moduleIndex, 'order'], message: 'Module order must be unique within its academic year.' });
    }
    yearOrders.add(module.order);
    moduleOrdersByYear.set(module.yearId, yearOrders);
    moduleIds.add(module.id);
  });
  reportDuplicateIds(activities, ['activities'], (issue) => context.addIssue(issue));
  const activityIds = new Set(activities.map((activity) => activity.id));
  const activityOrdersByModule = new Map<string, Set<number>>();
  activities.forEach((activity, activityIndex) => {
    if (!moduleIds.has(activity.moduleId)) {
      context.addIssue({ code: 'custom', path: ['activities', activityIndex, 'moduleId'], message: 'Activity must reference an existing module.' });
    }
    const moduleOrders = activityOrdersByModule.get(activity.moduleId) ?? new Set<number>();
    if (moduleOrders.has(activity.order)) {
      context.addIssue({ code: 'custom', path: ['activities', activityIndex, 'order'], message: 'Activity order must be unique within its module.' });
    }
    moduleOrders.add(activity.order);
    activityOrdersByModule.set(activity.moduleId, moduleOrders);
  });
  const assets = archive.assets ?? [];
  reportDuplicateIds(assets, ['assets'], (issue) => context.addIssue(issue));
  const assetOrdersByActivity = new Map<string, Set<number>>();
  assets.forEach((asset, assetIndex) => {
    if (!activityIds.has(asset.activityId)) {
      context.addIssue({ code: 'custom', path: ['assets', assetIndex, 'activityId'], message: 'Asset must reference an existing activity.' });
    }
    const extension = { PDF: 'pdf', DOCX: 'docx', XLSX: 'xlsx', ZIP: 'zip', CODE: 'code' }[asset.type];
    if (asset.path !== `public/storage/docs/${asset.id}.${extension}`) {
      context.addIssue({ code: 'custom', path: ['assets', assetIndex, 'path'], message: 'Asset path must be inside the canonical storage directory.' });
    }
    const activityOrders = assetOrdersByActivity.get(asset.activityId) ?? new Set<number>();
    if (activityOrders.has(asset.order)) {
      context.addIssue({ code: 'custom', path: ['assets', assetIndex, 'order'], message: 'Asset order must be unique within its activity.' });
    }
    activityOrders.add(asset.order);
    assetOrdersByActivity.set(asset.activityId, activityOrders);
  });
  const isolatedLinks = archive.isolatedLinks ?? [];
  reportDuplicateIds(isolatedLinks, ['isolatedLinks'], (issue) => context.addIssue(issue));
  const tokenHashes = new Set<string>();
  const primaryLinkScopes = new Set<string>();
  isolatedLinks.forEach((link, linkIndex) => {
    if (tokenHashes.has(link.tokenHash)) {
      context.addIssue({ code: 'custom', path: ['isolatedLinks', linkIndex, 'tokenHash'], message: 'Isolated link tokens must be unique.' });
    }
    tokenHashes.add(link.tokenHash);
    if (link.purpose === 'primary-professor') {
      const key = `${link.scopeType}:${link.scopeId}`;
      if (primaryLinkScopes.has(key)) {
        context.addIssue({ code: 'custom', path: ['isolatedLinks', linkIndex, 'purpose'], message: 'Each target can have only one primary Professor Link.' });
      }
      primaryLinkScopes.add(key);
    }
    const targetExists = link.scopeType === 'module'
      ? moduleIds.has(link.scopeId)
      : activityIds.has(link.scopeId);
    if (!targetExists) {
      context.addIssue({ code: 'custom', path: ['isolatedLinks', linkIndex, 'scopeId'], message: 'Isolated link must reference an existing target.' });
    }
  });
  const isolatedLinkById = new Map(isolatedLinks.map((link) => [link.id, link]));
  const feedbackKeys = new Set<string>();
  (archive.professorFeedback ?? []).forEach((feedback, feedbackIndex) => {
    const key = `${feedback.isolatedLinkId}:${feedback.activityId}`;
    if (feedbackKeys.has(key)) {
      context.addIssue({ code: 'custom', path: ['professorFeedback', feedbackIndex, 'activityId'], message: 'Only one current feedback record is allowed per isolated link and activity.' });
    }
    feedbackKeys.add(key);
    const isolatedLink = isolatedLinkById.get(feedback.isolatedLinkId);
    const activity = activities.find((item) => item.id === feedback.activityId);
    const activityInScope = isolatedLink?.scopeType === 'module'
      ? activity?.moduleId === isolatedLink.scopeId
      : isolatedLink?.scopeType === 'activity' && isolatedLink.scopeId === feedback.activityId;
    if (!activityInScope) {
      context.addIssue({ code: 'custom', path: ['professorFeedback', feedbackIndex, 'activityId'], message: 'Professor feedback must target an activity within its isolated link scope.' });
    }
  });
  archive.years.forEach((year, yearIndex) => {
    const modules = year.modules ?? [];
    reportDuplicateIds(modules, ['years', yearIndex, 'modules'], (issue) => context.addIssue(issue));
    for (const module of modules) {
      if (moduleIds.has(module.id)) {
        context.addIssue({ code: 'custom', path: ['years', yearIndex, 'modules'], message: 'Module identifiers must be unique.' });
      }
      moduleIds.add(module.id);
      reportDuplicateIds(module.activities, ['years', yearIndex, 'modules'], (issue) => context.addIssue(issue));
      module.activities.forEach((activity, activityIndex) => {
        reportDuplicateIds(activity.assets, ['years', yearIndex, 'modules', 'activities', activityIndex, 'assets'], (issue) => context.addIssue(issue));
      });
    }
  });
});

export function validateAcademicYearsTransition(previous: AcademicYear[], updated: AcademicYear[]) {
  const updatedIds = new Set(updated.map((year) => year.id));
  const previousIds = new Set(previous.map((year) => year.id));
  const addedYears = updated.filter((year) => !previousIds.has(year.id));

  for (const previousYear of previous) {
    if (updatedIds.has(previousYear.id)) continue;
    if (previousYear.modules && previousYear.modules.length > 0) {
      throw new ApiError(400, 'YEAR_HAS_MODULES', 'This academic year contains modules and cannot be deleted in this phase.');
    }

    const sameNameReplacement = addedYears.some((year) => (
      year.name.trim().toLocaleLowerCase('en-US') === previousYear.name.trim().toLocaleLowerCase('en-US')
    ));
    if (sameNameReplacement) {
      throw new ApiError(400, 'YEAR_ID_IMMUTABLE', 'Academic year IDs cannot be changed.');
    }
  }
}

export function parseAcademicArchive(value: unknown): AcademicArchive {
  const result = academicArchiveSchema.safeParse(value);
  if (!result.success) {
    throw new ApiError(400, 'DATA_VALIDATION_FAILED', 'Academic data does not match the required structure.');
  }
  return result.data;
}

export function normalizeProfileForWrite(profile: AcademicArchive['profile']): NonNullable<AcademicArchive['profile']> {
  const result = profileWriteSchema.safeParse(profile);
  if (!result.success) {
    throw new ApiError(400, 'PROFILE_VALIDATION_FAILED', 'Academic profile does not match the required fields.');
  }
  return result.data;
}
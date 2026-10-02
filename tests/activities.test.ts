import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../api/_lib/errors.ts';
import { parseAcademicArchive } from '../api/_lib/archive-schema.ts';
import { ADMIN_ACTIVITIES_ROUTE, resolveApplicationMode } from '../src/app/routing.ts';
import {
  moveActivity,
  deleteActivityCascade,
  nextActivityOrder,
  normalizeActivityOrders,
  placeActivity,
  sortActivities,
  validateActivityForm,
  type ActivityFormValues,
} from '../src/features/admin/activities/activities.ts';
import type { AcademicArchive, AcademicYear, IsolatedLink, Module, ProfessorFeedback } from '../src/types/academic.ts';

const years: AcademicYear[] = [
  { id: 'year-1', name: '2025/2026', status: 'current', order: 1 },
  { id: 'year-2', name: '2026/2027', status: 'upcoming', order: 2 },
];

const modules: Module[] = [
  { id: 'module-1', yearId: 'year-1', code: 'WEB-2', name: 'Web Development', description: '', order: 1, visibility: 'private' },
  { id: 'module-2', yearId: 'year-2', code: 'DB-1', name: 'Databases', description: '', order: 1, visibility: 'public' },
];

const activities = [
  { id: 'activity-b', moduleId: 'module-1', title: 'Form Exercise', description: 'Intro', type: 'exercise', order: 2, visibility: 'private' },
  { id: 'activity-a', moduleId: 'module-1', title: 'Lecture', description: '', type: 'lesson', order: 1, visibility: 'public' },
  { id: 'activity-c', moduleId: 'module-2', title: 'SQL Lab', description: '', type: 'lab', order: 1, visibility: 'unlisted' },
] as const;

const validForm: ActivityFormValues = {
  moduleId: 'module-1',
  title: 'Form Exercise',
  description: 'Build a form and validate it.',
  type: 'exercise',
  order: '1',
  visibility: 'private',
};

test('Activities route resolves inside the authenticated Admin application', () => {
  assert.equal(ADMIN_ACTIVITIES_ROUTE, '/admin/activities');
  assert.equal(resolveApplicationMode(ADMIN_ACTIVITIES_ROUTE, ''), 'admin');
});

test('activity validation requires a valid module, title, integer order, type, and visibility', () => {
  assert.equal(validateActivityForm(validForm, modules).valid, true);
  const invalid = validateActivityForm({
    ...validForm,
    moduleId: 'missing-module',
    title: ' ',
    type: 'invalid' as any,
    order: '0',
    visibility: 'visible' as any,
  }, modules);

  assert.deepEqual(invalid.errors, {
    moduleId: 'Select an existing module.',
    title: 'Activity Title is required.',
    order: 'Order must be a whole number from 1 to 1,000,000.',
    type: 'Select a valid activity type.',
    visibility: 'Select a valid visibility.',
  });
});

test('activities sort, move, and keep order per module', () => {
  assert.deepEqual(sortActivities(activities as any, modules).map((activity) => activity.id), ['activity-a', 'activity-b', 'activity-c']);
  assert.equal(nextActivityOrder(activities as any, 'module-1'), 3);

  const moved = moveActivity(activities as any, 'activity-b', -1, modules);
  assert.equal(moveActivity(activities as any, 'activity-a', -1, modules), activities);
  assert.equal(moveActivity(activities as any, 'activity-b', 1, modules), activities);
  assert.deepEqual(sortActivities(moved, modules).map((activity) => activity.id), ['activity-b', 'activity-a', 'activity-c']);
  for (const activity of moved) {
    const original = activities.find((item) => item.id === activity.id)!;
    assert.deepEqual({ ...activity, order: original.order }, original);
    assert.equal(activity.moduleId, original.moduleId);
  }

  const placed = placeActivity(activities as any, {
    id: 'activity-new', moduleId: 'module-1', title: 'Challenge', description: '', type: 'project', order: 1, visibility: 'public',
  }, modules);
  assert.deepEqual(sortActivities(placed, modules).map((activity) => activity.id), ['activity-new', 'activity-a', 'activity-b', 'activity-c']);
  assert.deepEqual(normalizeActivityOrders(activities as any, modules).filter((activity) => activity.moduleId === 'module-1').map((activity) => activity.order), [2, 1]);
});

test('archive accepts valid top-level activities and rejects a dangling moduleId', () => {
  const archive = {
    site: {},
    years,
    modules,
    activities: activities as any,
  };
  assert.deepEqual(parseAcademicArchive(archive), archive);
  assert.throws(() => parseAcademicArchive({ ...archive, activities: [{ ...activities[0], order: 0 }] }));
  assert.throws(() => parseAcademicArchive({ ...archive, activities: [activities[0], { ...activities[1], order: activities[0].order }] }));

  assert.throws(
    () => parseAcademicArchive({ ...archive, activities: [{ ...activities[0], moduleId: 'missing-module' }] }),
    (error: unknown) => error instanceof ApiError && error.code === 'DATA_VALIDATION_FAILED',
  );
});

test('activity requires a non-empty title at archive level', () => {
  assert.throws(
    () => parseAcademicArchive({
      site: {},
      years,
      modules,
      activities: [{
        id: 'activity-x',
        moduleId: 'module-1',
        title: ' ',
        description: '',
        type: 'exercise',
        order: 1,
        visibility: 'private',
      }],
    }),
    (error: unknown) => error instanceof ApiError && error.code === 'DATA_VALIDATION_FAILED',
  );
});

test('activity deletion keeps the remaining data intact', () => {
  const link: IsolatedLink = {
    id: 'activity-link', tokenHash: 'a'.repeat(64), tokenCiphertext: `v1.${'A'.repeat(16)}.${'A'.repeat(22)}.${'A'.repeat(58)}`,
    scopeType: 'activity', scopeId: 'activity-b', purpose: 'primary-professor', status: 'active', expiresAt: null,
  };
  const feedback: ProfessorFeedback = {
    isolatedLinkId: link.id, activityId: 'activity-b', professorName: 'Dr Example', score: 18,
    comments: 'Good work.', observations: '', submittedAt: '2026-09-30T10:00:00.000Z',
  };
  const archive: AcademicArchive = {
    site: {}, years, modules, activities: [...activities],
    assets: [
      { id: 'asset-b', activityId: 'activity-b', name: 'B.pdf', type: 'PDF', path: 'public/storage/docs/asset-b.pdf', order: 1, visibility: 'private' },
      { id: 'asset-a', activityId: 'activity-a', name: 'A.pdf', type: 'PDF', path: 'public/storage/docs/asset-a.pdf', order: 1, visibility: 'public' },
    ],
    isolatedLinks: [link],
    professorFeedback: [feedback],
  };

  const updated = deleteActivityCascade(archive, 'activity-b');
  assert.deepEqual(updated.activities?.map((activity) => activity.id), ['activity-a', 'activity-c']);
  assert.deepEqual(updated.assets?.map((asset) => asset.id), ['asset-a']);
  assert.deepEqual(updated.isolatedLinks, []);
  assert.deepEqual(updated.professorFeedback, []);
  assert.doesNotThrow(() => parseAcademicArchive(updated));
});

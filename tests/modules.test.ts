import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError } from '../api/_lib/errors.ts';
import { parseAcademicArchive } from '../api/_lib/archive-schema.ts';
import { ADMIN_MODULES_ROUTE, resolveApplicationMode } from '../src/app/routing.ts';
import {
  moveModule,
  deleteModuleCascade,
  normalizeModuleOrders,
  placeModule,
  sortModules,
  validateModuleForm,
  type ModuleFormValues,
} from '../src/features/admin/modules/modules.ts';
import type { AcademicArchive, AcademicYear, IsolatedLink, Module, ProfessorFeedback } from '../src/types/academic.ts';

const years: AcademicYear[] = [
  { id: 'year-1', name: '2025/2026', status: 'previous', order: 1 },
  { id: 'year-2', name: '2026/2027', status: 'current', order: 2 },
];

const modules: Module[] = [
  { id: 'module-b', yearId: 'year-1', code: 'WEB-2', name: 'Web Development', description: '', order: 2, visibility: 'private' },
  { id: 'module-a', yearId: 'year-1', code: 'NET-1', name: 'Networks', description: '', order: 1, visibility: 'public' },
  { id: 'module-c', yearId: 'year-2', code: 'DB-1', name: 'Databases', description: '', order: 1, visibility: 'unlisted' },
];

const validForm: ModuleFormValues = {
  yearId: 'year-1',
  code: 'WEB-2',
  name: 'Web Development',
  description: 'Foundations',
  order: '1',
  visibility: 'private',
};

test('Modules route resolves inside the authenticated Admin application', () => {
  assert.equal(ADMIN_MODULES_ROUTE, '/admin/modules');
  assert.equal(resolveApplicationMode(ADMIN_MODULES_ROUTE, ''), 'admin');
});

test('module validation requires an existing year, code, name, integer order, and valid visibility', () => {
  assert.equal(validateModuleForm(validForm, years).valid, true);
  const invalid = validateModuleForm({
    ...validForm,
    yearId: 'missing-year',
    code: ' ',
    name: ' ',
    order: '0',
    visibility: 'visible',
  }, years);
  assert.deepEqual(invalid.errors, {
    yearId: 'Select an existing academic year.',
    code: 'Module Code is required.',
    name: 'Module Name is required.',
    order: 'Order must be a whole number from 1 to 1,000,000.',
    visibility: 'Select a valid visibility.',
  });
});

test('modules sort and reorder within their Year using persisted order values', () => {
  assert.deepEqual(sortModules(modules, years).map((module) => module.id), ['module-a', 'module-b', 'module-c']);
  assert.equal(moveModule(modules, 'module-a', -1), modules);
  assert.equal(moveModule(modules, 'module-b', 1), modules);
  const moved = moveModule(modules, 'module-b', -1);
  assert.deepEqual(sortModules(moved, years).map((module) => module.id), ['module-b', 'module-a', 'module-c']);
  assert.deepEqual(moved.filter((module) => module.yearId === 'year-1').map((module) => module.order), [1, 2]);
  assert.deepEqual(normalizeModuleOrders(modules, years).filter((module) => module.yearId === 'year-1').map((module) => module.order), [2, 1]);
  for (const module of moved) {
    const original = modules.find((item) => item.id === module.id)!;
    assert.deepEqual({ ...module, order: original.order }, original);
    assert.equal(module.yearId, original.yearId);
  }
  assert.equal(moved.find((module) => module.id === 'module-b')?.id, 'module-b');

  const inserted = placeModule(modules, {
    id: 'module-new', yearId: 'year-1', code: 'ART-1', name: 'Architecture',
    description: '', order: 1, visibility: 'private',
  }, years);
  assert.deepEqual(sortModules(inserted, years).map((module) => module.id), ['module-new', 'module-a', 'module-b', 'module-c']);
  assert.deepEqual(inserted.filter((module) => module.yearId === 'year-1').map((module) => module.order), [1, 2, 3]);
});

test('deleting a module removes its activities, asset records, and isolated links while preserving other modules', () => {
  const link = (id: string, scopeType: 'module' | 'activity', scopeId: string, purpose?: IsolatedLink['purpose']): IsolatedLink => ({
    id,
    ...(purpose ? { purpose } : {}),
    tokenHash: `${id === 'module-link' ? '1' : id === 'activity-link' ? '2' : '3'}`.repeat(64),
    tokenCiphertext: `v1.${'A'.repeat(16)}.${'A'.repeat(22)}.${'A'.repeat(58)}`,
    scopeType,
    scopeId,
    status: 'active' as const,
    expiresAt: null,
  });
  const feedback = (isolatedLinkId: string, activityId: string): ProfessorFeedback => ({
    isolatedLinkId,
    activityId,
    professorName: 'Dr Example',
    score: 18,
    comments: 'Good work.',
    observations: '',
    submittedAt: '2026-09-30T10:00:00.000Z',
  });
  const archive: AcademicArchive = {
    site: {},
    years,
    modules,
    activities: [
      { id: 'activity-b', moduleId: 'module-b', title: 'Activity B', type: 'exercise', order: 1, visibility: 'private' },
      { id: 'activity-c', moduleId: 'module-c', title: 'Activity C', type: 'project', order: 1, visibility: 'public' },
    ],
    assets: [
      { id: 'asset-b', activityId: 'activity-b', name: 'B.pdf', type: 'PDF', path: 'public/storage/docs/asset-b.pdf', order: 1, visibility: 'private' },
      { id: 'asset-c', activityId: 'activity-c', name: 'C.pdf', type: 'PDF', path: 'public/storage/docs/asset-c.pdf', order: 1, visibility: 'public' },
    ],
    isolatedLinks: [
      link('module-link', 'module', 'module-b', 'primary-professor'),
      link('activity-link', 'activity', 'activity-b', 'primary-professor'),
      link('other-link', 'module', 'module-c'),
    ],
    professorFeedback: [
      feedback('module-link', 'activity-b'),
      feedback('activity-link', 'activity-b'),
      feedback('other-link', 'activity-c'),
    ],
  };

  const updated = deleteModuleCascade(archive, 'module-b');
  assert.deepEqual(updated.modules?.map((module) => module.id), ['module-a', 'module-c']);
  assert.deepEqual(updated.activities?.map((activity) => activity.id), ['activity-c']);
  assert.deepEqual(updated.assets?.map((asset) => asset.id), ['asset-c']);
  assert.deepEqual(updated.isolatedLinks?.map((isolatedLink) => isolatedLink.id), ['other-link']);
  assert.deepEqual(updated.professorFeedback?.map((record) => record.isolatedLinkId), ['other-link']);
  assert.doesNotThrow(() => parseAcademicArchive(updated));
});

test('archive accepts valid top-level modules and rejects a dangling yearId', () => {
  const archive = { site: {}, profile: {}, years, modules };
  assert.deepEqual(parseAcademicArchive(archive), archive);
  assert.throws(() => parseAcademicArchive({ ...archive, modules: [{ ...modules[0]!, order: 0 }] }));
  assert.throws(() => parseAcademicArchive({ ...archive, modules: [modules[0]!, { ...modules[1]!, order: modules[0]!.order }] }));
  assert.throws(
    () => parseAcademicArchive({ ...archive, modules: [{ ...modules[0], yearId: 'missing-year' }] }),
    (error: unknown) => error instanceof ApiError && error.code === 'DATA_VALIDATION_FAILED',
  );
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyYearStatus,
  moveYear,
  normalizeYearOrder,
  sortYearsByOrder,
  validateAcademicYearForm,
} from '../src/features/admin/years/academicYears.ts';
import type { AcademicYear } from '../src/types/academic.ts';

const yearA: AcademicYear = { id: 'year-a', name: '2024/2025', status: 'previous', order: 1, modules: [] };
const yearB: AcademicYear = { id: 'year-b', name: '2025/2026', status: 'current', order: 2, modules: [] };
const yearC: AcademicYear = { id: 'year-c', name: '2026/2027', status: 'upcoming', order: 3, modules: [] };

test('academic year form validates name limits, normalized duplicates, and exact statuses', () => {
  assert.equal(validateAcademicYearForm({ name: '   ', status: 'upcoming' }, []).errors.name, 'Academic Year Name is required.');
  assert.equal(validateAcademicYearForm({ name: 'abc', status: 'upcoming' }, []).errors.name, 'Academic Year Name is too short.');
  assert.equal(validateAcademicYearForm({ name: 'x'.repeat(41), status: 'previous' }, []).errors.name, 'Maximum length exceeded.');
  assert.equal(
    validateAcademicYearForm({ name: ' 2025/2026 ', status: 'current' }, [yearA, yearB, yearC]).errors.name,
    'An academic year with this name already exists.',
  );
  assert.equal(validateAcademicYearForm({ name: '2027/2028', status: 'active' }, []).errors.status, 'Please select a valid status.');
  assert.deepEqual(validateAcademicYearForm({ name: ' 2027/2028 ', status: 'upcoming' }, []).values, {
    name: '2027/2028',
    status: 'upcoming',
  });
});

test('normalization persists one-based order and display sorts by stored order', () => {
  const outOfOrder = [{ ...yearC, order: 9 }, { ...yearA, order: 4 }, { ...yearB, order: 7 }];
  assert.deepEqual(sortYearsByOrder(outOfOrder).map((year) => year.id), ['year-a', 'year-b', 'year-c']);
  assert.deepEqual(normalizeYearOrder(sortYearsByOrder(outOfOrder)).map((year) => year.order), [1, 2, 3]);
});

test('reordering only swaps items and normalizes their order values', () => {
  const movedUp = moveYear([yearA, yearB, yearC], 1, -1);
  assert.deepEqual(movedUp.map(({ id, order }) => [id, order]), [['year-b', 1], ['year-a', 2], ['year-c', 3]]);
  assert.deepEqual(movedUp.map(({ status }) => status), ['current', 'previous', 'upcoming']);
  assert.deepEqual(moveYear([yearA, yearB], 0, -1), [yearA, yearB]);
  const years = [yearA, yearB, yearC];
  assert.equal(moveYear(years, 0, -1), years);
  assert.equal(moveYear(years, 2, 1), years);
  const movedDown = moveYear([yearA, yearB, yearC], 1, 1);
  assert.deepEqual(movedDown.map(({ id, order }) => [id, order]), [['year-a', 1], ['year-c', 2], ['year-b', 3]]);
  assert.deepEqual(moveYear([yearA, yearB], 1, 1), [yearA, yearB]);
});

test('setting a Current year demotes only the prior Current year to Previous', () => {
  const changed = applyYearStatus([yearA, yearB, yearC], 'year-c', 'current');
  assert.deepEqual(changed.map(({ id, status }) => [id, status]), [
    ['year-a', 'previous'],
    ['year-b', 'previous'],
    ['year-c', 'current'],
  ]);
  assert.deepEqual(applyYearStatus([yearA, yearB, yearC], 'year-c', 'upcoming').map(({ status }) => status), [
    'previous', 'current', 'upcoming',
  ]);
});
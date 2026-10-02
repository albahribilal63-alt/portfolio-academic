import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADMIN_PROFILE_ROUTE, ADMIN_ROUTE, ADMIN_YEARS_ROUTE, resolveApplicationMode } from '../src/app/routing.ts';
import { parseAcademicArchive } from '../api/_lib/archive-schema.ts';
import {
  createProfileUpdate,
  hasProfileFormChanged,
  normalizeProfileForm,
  profileToForm,
  validateProfileForm,
  type ProfileFormValues,
} from '../src/features/admin/profile/profileForm.ts';

const validForm: ProfileFormValues = {
  lastName: 'ELBAHRI',
  firstName: 'Bilal',
  filiere: 'IAP3',
  section: 'Section I',
  tdGroup: 'Gr_01',
};

test('profile route resolves to the authenticated admin mode without changing the dashboard route', () => {
  assert.equal(ADMIN_PROFILE_ROUTE, '/admin/profile');
  assert.equal(ADMIN_YEARS_ROUTE, '/admin/years');
  assert.equal(resolveApplicationMode(ADMIN_PROFILE_ROUTE, ''), 'admin');
  assert.equal(resolveApplicationMode(ADMIN_YEARS_ROUTE, ''), 'admin');
  assert.equal(resolveApplicationMode(`${ADMIN_ROUTE}/future-child`, ''), 'admin');
  assert.equal(resolveApplicationMode(ADMIN_ROUTE, ''), 'admin');
  assert.equal(resolveApplicationMode('/profile', ''), 'not-found');
});

test('profile normalization returns the five academic identity fields and trims only their edges', () => {
  const normalized = normalizeProfileForm({
    ...validForm,
    lastName: '  ELBAHRI  ',
    firstName: '  Bilal  ',
    filiere: '  IAP3  ',
    section: '  Section I  ',
    tdGroup: '  Gr_01  ',
  });
  assert.deepEqual(normalized, {
    ...validForm,
    lastName: 'ELBAHRI',
    firstName: 'Bilal',
    filiere: 'IAP3',
    section: 'Section I',
    tdGroup: 'Gr_01',
  });
  assert.deepEqual(Object.keys(profileToForm(undefined)), [
    'lastName', 'firstName', 'filiere', 'section', 'tdGroup',
  ]);
});

test('profile validation enforces required and maximum lengths with the specified messages', () => {
  const emptyResult = validateProfileForm({
    lastName: '  ',
    firstName: '',
    filiere: 'X',
    section: '',
    tdGroup: '',
  });
  assert.deepEqual(emptyResult.errors, {
    lastName: 'Nom is required.',
    firstName: 'Prénom is required.',
    filiere: 'Filière is required.',
    section: 'Section is required.',
    tdGroup: 'Groupe TD is required.',
  });

  const maximums = validateProfileForm({
    ...validForm,
    lastName: 'N'.repeat(121),
    firstName: 'F'.repeat(121),
    filiere: 'P'.repeat(161),
    section: 'S'.repeat(101),
    tdGroup: 'G'.repeat(101),
  });
  assert.deepEqual(maximums.errors, Object.fromEntries([
    'lastName', 'firstName', 'filiere', 'section', 'tdGroup',
  ].map((field) => [field, 'Maximum length exceeded.'])));
});

test('dirty detection only compares the five editable academic fields', () => {
  const original = profileToForm({ ...validForm, title: 'Preserved title', biography: 'Preserved text' });
  assert.equal(hasProfileFormChanged({ ...original }, original), false);
  assert.equal(hasProfileFormChanged({ ...original, section: 'Section II' }, original), true);
  assert.equal(hasProfileFormChanged({ ...original, tdGroup: 'Gr_02' }, original), true);
});

test('profile update preserves the entire remote archive and existing profile properties immutably', () => {
  const remote = parseAcademicArchive({
    site: { title: 'Existing site', customSite: { marker: true } },
    profile: { title: 'Legacy title', biography: 'Keep this', customProfile: { marker: 7 } },
    years: [{
      id: 'year-1',
      name: 'Existing year',
      status: 'previous',
      order: 1,
      customYear: 'keep',
      modules: [{
        id: 'module-1',
        title: 'Existing module',
        customModule: ['keep'],
        activities: [{
          id: 'activity-1',
          title: 'Existing activity',
          customActivity: 'keep',
          assets: [{
            id: 'asset-1',
            name: 'Existing document',
            kind: 'document',
            url: '/storage/docs/existing.pdf',
            customAsset: 42,
          }],
        }],
      }],
    }],
    futureTopLevel: { marker: 'keep' },
  });
  const original = structuredClone(remote);
  const updated = createProfileUpdate(remote, validForm);

  assert.deepEqual(remote, original);
  assert.deepEqual(updated.site, original.site);
  assert.deepEqual(updated.years, original.years);
  assert.deepEqual(updated.profile, {
    ...original.profile,
    ...validForm,
  });
  assert.deepEqual(updated, { ...original, profile: { ...original.profile, ...validForm } });
  assert.notEqual(updated, remote);
  assert.notEqual(updated.profile, remote.profile);
  assert.equal(updated.years, remote.years);
});

test('legacy profile values prefill equivalent academic fields without inventing a TD group', () => {
  assert.deepEqual(profileToForm({ name: 'Bilal ELBAHRI', program: 'IAP3', branch: 'Section I' }), {
    lastName: 'ELBAHRI',
    firstName: 'Bilal',
    filiere: 'IAP3',
    section: 'Section I',
    tdGroup: '',
  });
});
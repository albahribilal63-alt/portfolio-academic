import type { AcademicArchive, Profile } from '../../../types/academic.ts';

export interface ProfileFormValues {
  lastName: string;
  firstName: string;
  filiere: string;
  section: string;
  tdGroup: string;
}

export type ProfileFormField = keyof ProfileFormValues;
export type ProfileFormErrors = Partial<Record<ProfileFormField, string>>;

export const PROFILE_FORM_FIELDS: ProfileFormField[] = [
  'lastName',
  'firstName',
  'filiere',
  'section',
  'tdGroup',
];

export function profileToForm(profile?: Profile): ProfileFormValues {
  const legacyNameParts = profile?.name?.trim().split(/\s+/).filter(Boolean) ?? [];
  return {
    lastName: profile?.lastName ?? (legacyNameParts.length > 1 ? legacyNameParts.at(-1)! : ''),
    firstName: profile?.firstName ?? (legacyNameParts.length > 1 ? legacyNameParts.slice(0, -1).join(' ') : legacyNameParts[0] ?? ''),
    filiere: profile?.filiere ?? profile?.program ?? '',
    section: profile?.section ?? profile?.branch ?? '',
    tdGroup: profile?.tdGroup ?? '',
  };
}

export function normalizeProfileForm(values: ProfileFormValues): ProfileFormValues {
  return {
    lastName: values.lastName.trim(),
    firstName: values.firstName.trim(),
    filiere: values.filiere.trim(),
    section: values.section.trim(),
    tdGroup: values.tdGroup.trim(),
  };
}

export function validateProfileForm(values: ProfileFormValues) {
  const normalized = normalizeProfileForm(values);
  const errors: ProfileFormErrors = {};

  if (normalized.lastName.length < 2) errors.lastName = 'Nom is required.';
  else if (normalized.lastName.length > 120) errors.lastName = 'Maximum length exceeded.';
  if (normalized.firstName.length < 2) errors.firstName = 'Prénom is required.';
  else if (normalized.firstName.length > 120) errors.firstName = 'Maximum length exceeded.';
  if (normalized.filiere.length < 2) errors.filiere = 'Filière is required.';
  else if (normalized.filiere.length > 160) errors.filiere = 'Maximum length exceeded.';
  if (!normalized.section) errors.section = 'Section is required.';
  else if (normalized.section.length > 100) errors.section = 'Maximum length exceeded.';
  if (!normalized.tdGroup) errors.tdGroup = 'Groupe TD is required.';
  else if (normalized.tdGroup.length > 100) errors.tdGroup = 'Maximum length exceeded.';

  return { values: normalized, errors, valid: Object.keys(errors).length === 0 };
}

export function hasProfileFormChanged(values: ProfileFormValues, original: ProfileFormValues) {
  return PROFILE_FORM_FIELDS.some((field) => values[field] !== original[field]);
}

export function createProfileUpdate(data: AcademicArchive, values: ProfileFormValues): AcademicArchive {
  const profile: Profile = {
    ...data.profile,
    ...normalizeProfileForm(values),
  };
  return { ...data, profile };
}
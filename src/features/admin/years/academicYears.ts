import type { AcademicYear, AcademicYearStatus } from '../../../types/academic.ts';

export interface AcademicYearFormValues {
  name: string;
  status: string;
}

export interface AcademicYearFormErrors {
  name?: string;
  status?: string;
}

export function sortYearsByOrder(years: AcademicYear[]) {
  return [...years].sort((left, right) => left.order - right.order);
}

export function normalizeYearOrder(years: AcademicYear[]): AcademicYear[] {
  return years.map((year, index) => ({ ...year, order: index + 1 }));
}

export function validateAcademicYearForm(
  values: AcademicYearFormValues,
  years: AcademicYear[],
  editingId?: string,
) {
  const name = values.name.trim();
  const errors: AcademicYearFormErrors = {};

  if (!name) errors.name = 'Academic Year Name is required.';
  else if (name.length < 4) errors.name = 'Academic Year Name is too short.';
  else if (name.length > 40) errors.name = 'Maximum length exceeded.';
  else if (years.some((year) => (
    year.id !== editingId
    && year.name.trim().toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US')
  ))) errors.name = 'An academic year with this name already exists.';

  if (!['previous', 'current', 'upcoming'].includes(values.status)) {
    errors.status = 'Please select a valid status.';
  }

  return {
    values: { name, status: values.status as AcademicYearStatus },
    errors,
    valid: Object.keys(errors).length === 0,
  };
}

export function applyYearStatus(
  years: AcademicYear[],
  targetId: string,
  status: AcademicYearStatus,
): AcademicYear[] {
  return years.map((year) => {
    if (year.id === targetId) return { ...year, status };
    if (status === 'current' && year.status === 'current') return { ...year, status: 'previous' };
    return year;
  });
}

export function moveYear(years: AcademicYear[], index: number, offset: -1 | 1) {
  const nextIndex = index + offset;
  if (nextIndex < 0 || nextIndex >= years.length) return years;
  const reordered = [...years];
  [reordered[index], reordered[nextIndex]] = [reordered[nextIndex]!, reordered[index]!];
  return normalizeYearOrder(reordered);
}
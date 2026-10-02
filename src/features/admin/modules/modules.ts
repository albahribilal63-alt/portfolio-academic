import type { AcademicArchive, AcademicYear, Module, Visibility } from '../../../types/academic';

export const MODULE_VISIBILITY_OPTIONS: Visibility[] = ['public', 'private', 'unlisted'];

export interface ModuleFormValues {
  yearId: string;
  code: string;
  name: string;
  description: string;
  order: string;
  visibility: string;
}

export interface ModuleFormErrors {
  yearId?: string;
  code?: string;
  name?: string;
  order?: string;
  visibility?: string;
}

export function sortModules(modules: Module[], years: AcademicYear[]): Module[] {
  const yearOrders = new Map(years.map((year, index) => [year.id, year.order ?? index]));
  return modules
    .map((module, index) => ({ module, index }))
    .sort((left, right) => (
      (yearOrders.get(left.module.yearId) ?? Number.MAX_SAFE_INTEGER)
        - (yearOrders.get(right.module.yearId) ?? Number.MAX_SAFE_INTEGER)
      || left.module.yearId.localeCompare(right.module.yearId)
      || left.module.order - right.module.order
      || left.index - right.index
    ))
    .map(({ module }) => module);
}

export function validateModuleForm(values: ModuleFormValues, years: AcademicYear[]) {
  const normalized = {
    yearId: values.yearId,
    code: values.code.trim(),
    name: values.name.trim(),
    description: values.description.trim(),
    order: Number(values.order),
    visibility: values.visibility as Visibility,
  };
  const errors: ModuleFormErrors = {};

  if (!years.some((year) => year.id === normalized.yearId)) errors.yearId = 'Select an existing academic year.';
  if (!normalized.code) errors.code = 'Module Code is required.';
  if (!normalized.name) errors.name = 'Module Name is required.';
  if (!/^[1-9]\d*$/.test(values.order.trim()) || !Number.isSafeInteger(normalized.order) || normalized.order > 1_000_000) {
    errors.order = 'Order must be a whole number from 1 to 1,000,000.';
  }
  if (!MODULE_VISIBILITY_OPTIONS.includes(normalized.visibility)) errors.visibility = 'Select a valid visibility.';

  return { values: normalized, errors, valid: Object.keys(errors).length === 0 };
}

export function nextModuleOrder(modules: Module[], yearId: string): number {
  return modules.filter((module) => module.yearId === yearId).length + 1;
}

export function placeModule(modules: Module[], module: Module, years: AcademicYear[]): Module[] {
  const withoutModule = modules.filter((item) => item.id !== module.id);
  const sameYear = withoutModule
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.yearId === module.yearId)
    .sort((left, right) => left.item.order - right.item.order || left.index - right.index)
    .map(({ item }) => item);
  const insertionIndex = Math.min(Math.max(module.order - 1, 0), sameYear.length);
  sameYear.splice(insertionIndex, 0, module);

  const placed = [...withoutModule.filter((item) => item.yearId !== module.yearId), ...sameYear];
  return normalizeModuleOrders(placed, years);
}

export function normalizeModuleOrders(modules: Module[], years: AcademicYear[]): Module[] {
  const orderById = new Map<string, number>();
  for (const year of years) {
    const ordered = modules
      .map((module, index) => ({ module, index }))
      .filter(({ module }) => module.yearId === year.id)
      .sort((left, right) => left.module.order - right.module.order || left.index - right.index);
    ordered.forEach(({ module }, index) => orderById.set(module.id, index + 1));
  }
  return modules.map((module) => ({ ...module, order: orderById.get(module.id) ?? module.order }));
}

export function deleteModuleCascade(archive: AcademicArchive, moduleId: string): AcademicArchive {
  const removedActivityIds = new Set((archive.activities ?? [])
    .filter((activity) => activity.moduleId === moduleId)
    .map((activity) => activity.id));
  const removedIsolatedLinkIds = new Set((archive.isolatedLinks ?? [])
    .filter((link) => link.scopeType === 'module'
      ? link.scopeId === moduleId
      : removedActivityIds.has(link.scopeId))
    .map((link) => link.id));

  return {
    ...archive,
    modules: normalizeModuleOrders(
      (archive.modules ?? []).filter((module) => module.id !== moduleId),
      archive.years,
    ),
    activities: (archive.activities ?? []).filter((activity) => activity.moduleId !== moduleId),
    assets: (archive.assets ?? []).filter((asset) => !removedActivityIds.has(asset.activityId)),
    isolatedLinks: (archive.isolatedLinks ?? []).filter((link) => (
      link.scopeType === 'module' ? link.scopeId !== moduleId : !removedActivityIds.has(link.scopeId)
    )),
    professorFeedback: (archive.professorFeedback ?? []).filter((feedback) => (
      !removedIsolatedLinkIds.has(feedback.isolatedLinkId) && !removedActivityIds.has(feedback.activityId)
    )),
  };
}

export function moveModule(modules: Module[], moduleId: string, offset: -1 | 1): Module[] {
  const selected = modules.find((module) => module.id === moduleId);
  if (!selected) return modules;
  const ordered = modules.filter((module) => module.yearId === selected.yearId).sort((left, right) => left.order - right.order);
  const index = ordered.findIndex((module) => module.id === moduleId);
  const target = index + offset;
  if (target < 0 || target >= ordered.length) return modules;
  [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
  const orderById = new Map(ordered.map((module, index) => [module.id, index + 1]));
  return modules.map((module) => ({ ...module, order: orderById.get(module.id) ?? module.order }));
}

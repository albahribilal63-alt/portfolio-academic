import type { AcademicArchive, Activity, ActivityType, Module, Visibility } from '../../../types/academic';

export const ACTIVITY_TYPE_OPTIONS: ActivityType[] = ['lesson', 'exercise', 'project', 'quiz', 'lab', 'workshop', 'reading', 'other'];
export const ACTIVITY_VISIBILITY_OPTIONS: Visibility[] = ['public', 'private', 'unlisted'];

export interface ActivityFormValues {
  moduleId: string;
  title: string;
  description: string;
  type: ActivityType;
  order: string;
  visibility: Visibility;
}

export interface ActivityFormErrors {
  moduleId?: string;
  title?: string;
  order?: string;
  type?: string;
  visibility?: string;
}

export function sortActivities(activities: Activity[], modules: Module[]): Activity[] {
  const moduleOrder = new Map(modules.map((module) => [module.id, module.order]));
  return [...activities].sort((left, right) => {
    const leftModuleOrder = moduleOrder.get(left.moduleId) ?? Number.MAX_SAFE_INTEGER;
    const rightModuleOrder = moduleOrder.get(right.moduleId) ?? Number.MAX_SAFE_INTEGER;
    return leftModuleOrder - rightModuleOrder || left.moduleId.localeCompare(right.moduleId) || left.order - right.order;
  });
}

export function validateActivityForm(values: ActivityFormValues, modules: Module[]) {
  const normalized = {
    moduleId: values.moduleId.trim(),
    title: values.title.trim(),
    description: values.description.trim(),
    type: values.type as ActivityType,
    order: Number(values.order),
    visibility: values.visibility as Visibility,
  };
  const errors: ActivityFormErrors = {};

  if (!modules.some((module) => module.id === normalized.moduleId)) {
    errors.moduleId = 'Select an existing module.';
  }
  if (!normalized.title) errors.title = 'Activity Title is required.';
  if (!/^[1-9]\d*$/.test(values.order.trim()) || !Number.isSafeInteger(normalized.order) || normalized.order > 1_000_000) {
    errors.order = 'Order must be a whole number from 1 to 1,000,000.';
  }
  if (!ACTIVITY_TYPE_OPTIONS.includes(normalized.type)) errors.type = 'Select a valid activity type.';
  if (!ACTIVITY_VISIBILITY_OPTIONS.includes(normalized.visibility)) errors.visibility = 'Select a valid visibility.';

  return { values: normalized, errors, valid: Object.keys(errors).length === 0 };
}

export function nextActivityOrder(activities: Activity[], moduleId: string): number {
  return activities.filter((activity) => activity.moduleId === moduleId).length + 1;
}

export function normalizeActivityOrders(activities: Activity[], modules: Module[]): Activity[] {
  const orderById = new Map<string, number>();
  const moduleIds = new Set(modules.map((module) => module.id));
  for (const moduleId of moduleIds) {
    const ordered = activities
      .map((activity, index) => ({ activity, index }))
      .filter(({ activity }) => activity.moduleId === moduleId)
      .sort((left, right) => left.activity.order - right.activity.order || left.index - right.index);
    ordered.forEach(({ activity }, index) => orderById.set(activity.id, index + 1));
  }

  return activities.map((activity) => ({ ...activity, order: orderById.get(activity.id) ?? activity.order }));
}

export function placeActivity(activities: Activity[], activity: Activity, modules: Module[]): Activity[] {
  const withoutActivity = activities.filter((item) => item.id !== activity.id);
  const sameModule = withoutActivity
    .filter((item) => item.moduleId === activity.moduleId)
    .sort((left, right) => left.order - right.order);
  const insertionIndex = Math.min(Math.max(activity.order - 1, 0), sameModule.length);
  sameModule.splice(insertionIndex, 0, activity);

  const placed = [
    ...withoutActivity.filter((item) => item.moduleId !== activity.moduleId),
    ...sameModule,
  ];
  return normalizeActivityOrders(placed, modules);
}

export function deleteActivityCascade(archive: AcademicArchive, activityId: string): AcademicArchive {
  const removedLinkIds = new Set((archive.isolatedLinks ?? [])
    .filter((link) => link.scopeType === 'activity' && link.scopeId === activityId)
    .map((link) => link.id));
  const activities = (archive.activities ?? []).filter((activity) => activity.id !== activityId);
  const modules = archive.modules ?? [];

  return {
    ...archive,
    activities: normalizeActivityOrders(activities, modules),
    assets: (archive.assets ?? []).filter((asset) => asset.activityId !== activityId),
    isolatedLinks: (archive.isolatedLinks ?? []).filter((link) => !removedLinkIds.has(link.id)),
    professorFeedback: (archive.professorFeedback ?? []).filter((feedback) => (
      feedback.activityId !== activityId && !removedLinkIds.has(feedback.isolatedLinkId)
    )),
  };
}

export function moveActivity(activities: Activity[], activityId: string, offset: -1 | 1, modules: Module[]): Activity[] {
  void modules;
  const selected = activities.find((activity) => activity.id === activityId);
  if (!selected) return activities;
  const ordered = activities
    .filter((activity) => activity.moduleId === selected.moduleId)
    .sort((left, right) => left.order - right.order);
  const index = ordered.findIndex((activity) => activity.id === activityId);
  const target = index + offset;
  if (target < 0 || target >= ordered.length) return activities;

  [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
  const orderById = new Map(ordered.map((activity, index) => [activity.id, index + 1]));
  return activities.map((activity) => ({ ...activity, order: orderById.get(activity.id) ?? activity.order }));
}

import type { AcademicFileType, Activity, Asset, Visibility } from '../../../types/academic';

export const ACADEMIC_FILE_TYPES: AcademicFileType[] = ['PDF', 'DOCX', 'XLSX', 'ZIP', 'CODE'];
export const CODE_SOURCE_EXTENSIONS = ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'go', 'rs', 'php', 'rb', 'html', 'css', 'json', 'xml', 'sh', 'sql', 'md'] as const;
export const ASSET_FILE_ACCEPT = ['.pdf', '.docx', '.xlsx', '.zip', ...CODE_SOURCE_EXTENSIONS.map((extension) => `.${extension}`)].join(',');

export const FILE_TYPE_EXTENSIONS: Record<AcademicFileType, string> = {
  PDF: 'pdf',
  DOCX: 'docx',
  XLSX: 'xlsx',
  ZIP: 'zip',
  CODE: 'code',
};

export const ASSET_STORAGE_ROOT = 'public/storage/docs';

export interface AssetFormValues {
  activityId: string;
  name: string;
  order: string;
  visibility: string;
}

export type AssetFormErrors = Partial<Record<keyof AssetFormValues | 'file', string>>;

export function fileTypeFromName(name: string): AcademicFileType | undefined {
  const extension = name.split('.').pop()?.toLowerCase();
  if (CODE_SOURCE_EXTENSIONS.includes(extension as typeof CODE_SOURCE_EXTENSIONS[number])) return 'CODE';
  return ACADEMIC_FILE_TYPES.find((type) => FILE_TYPE_EXTENSIONS[type] === extension);
}

export function assetRepositoryPath(id: string, type: AcademicFileType): string {
  return `${ASSET_STORAGE_ROOT}/${id}.${FILE_TYPE_EXTENSIONS[type]}`;
}

export function isCanonicalAssetPath(path: string, id: string, type: AcademicFileType): boolean {
  return path === assetRepositoryPath(id, type)
    && !path.includes('..')
    && !path.includes('\\')
    && !path.startsWith('/');
}

export function validateAssetName(name: string): string | undefined {
  const normalized = name.trim();
  if (!normalized) return 'Enter a file name.';
  if (normalized.length > 255) return 'File name must be 255 characters or fewer.';
  if (normalized === '.' || normalized === '..' || /[\\/\u0000-\u001f\u007f]/.test(normalized)) {
    return 'File name contains unsupported characters.';
  }
  if (!fileTypeFromName(normalized)) return 'Choose a PDF, DOCX, XLSX, ZIP, or source-code file.';
  return undefined;
}

export function validateAssetForm(values: AssetFormValues, activities: Activity[]) {
  const errors: AssetFormErrors = {};
  const activityId = values.activityId.trim();
  const name = values.name.trim();
  const orderValue = values.order.trim();
  const order = Number(orderValue);
  const visibility = values.visibility;

  if (!activities.some((activity) => activity.id === activityId)) errors.activityId = 'Select an existing activity.';
  const nameError = validateAssetName(name);
  if (nameError) errors.name = nameError;
  if (!/^[1-9]\d*$/.test(orderValue) || !Number.isSafeInteger(order) || order > 1_000_000) {
    errors.order = 'Order must be a whole number from 1 to 1,000,000.';
  }
  if (!['public', 'private', 'unlisted'].includes(visibility)) errors.visibility = 'Select a valid visibility.';

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    values: {
      activityId,
      name,
      order,
      visibility: visibility as Visibility,
    },
  };
}

export function sortAssets(assets: Asset[], activities: Activity[]): Asset[] {
  const activityOrder = new Map(activities.map((activity) => [activity.id, activity.order]));
  return [...assets].sort((left, right) => (
    left.activityId.localeCompare(right.activityId)
    || left.order - right.order
    || left.name.localeCompare(right.name)
    || (activityOrder.get(left.activityId) ?? 0) - (activityOrder.get(right.activityId) ?? 0)
  ));
}

export function normalizeAssetOrders(assets: Asset[]): Asset[] {
  const byActivity = new Map<string, Asset[]>();
  for (const asset of assets) {
    const group = byActivity.get(asset.activityId) ?? [];
    group.push(asset);
    byActivity.set(asset.activityId, group);
  }
  return [...byActivity.values()].flatMap((group) => group
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
    .map((asset, index) => ({ ...asset, order: index + 1 })));
}

export function moveAsset(assets: Asset[], assetId: string, offset: -1 | 1): Asset[] {
  const asset = assets.find((item) => item.id === assetId);
  if (!asset) return assets;
  const group = assets.filter((item) => item.activityId === asset.activityId)
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
  const index = group.findIndex((item) => item.id === assetId);
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || nextIndex >= group.length) return assets;
  [group[index], group[nextIndex]] = [group[nextIndex]!, group[index]!];
  const orderById = new Map(group.map((item, itemIndex) => [item.id, itemIndex + 1]));
  return assets.map((item) => orderById.has(item.id) ? { ...item, order: orderById.get(item.id)! } : item);
}
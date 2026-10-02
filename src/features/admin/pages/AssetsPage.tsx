import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, BookOpen, ClipboardList, Code2, Eye, EyeOff, FileArchive, FileSpreadsheet, FileText, Pencil, Plus, Replace, Trash2 } from 'lucide-react';
import { adminApi, AdminApiRequestError } from '../services/adminApi';
import type { AcademicArchive, AcademicFileType, Activity, Asset, Module, Visibility } from '../../../types/academic';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { LoadingState } from '../../../components/ui/LoadingState';
import { Modal } from '../../../components/ui/Modal';
import { AdminPageContainer } from '../components/AdminPageContainer';
import { useLocale } from '../../../app/i18n/LocaleProvider';
import { AnimatedDisclosure } from '../components/AnimatedModuleAccordion';
import { sortModules } from '../modules/modules';
import { ASSET_FILE_ACCEPT, fileTypeFromName, moveAsset, sortAssets, validateAssetForm, validateAssetName, type AssetFormErrors, type AssetFormValues } from '../assets/assets';
import { useAdminData } from '../data/AdminDataProvider';

type EditorState = { kind: 'closed' } | { kind: 'create' | 'edit'; assetId?: string; values: AssetFormValues };
type PageStatus = { kind: 'success' | 'error' | 'conflict' | 'validation'; message: string } | null;

interface AssetsPageProps {
  onRequireLogin: () => void;
  onUnsavedChanges: (hasChanges: boolean) => void;
}

const VISIBILITY_LABELS: Record<Visibility, string> = { public: 'Public', private: 'Private', unlisted: 'Unlisted' };
const TYPE_ICONS: Record<AcademicFileType, typeof FileText> = { PDF: FileText, DOCX: FileText, XLSX: FileSpreadsheet, ZIP: FileArchive, CODE: Code2 };
const EMPTY_FORM: AssetFormValues = { activityId: '', name: '', order: '1', visibility: 'private' };

export function AssetsPage({ onRequireLogin, onUnsavedChanges }: AssetsPageProps) {
  const { t } = useLocale();
  const { data: initialData, sha: initialSha, refresh, replaceArchive } = useAdminData();
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('ready');
  const [remoteData, setRemoteData] = useState<AcademicArchive>(initialData);
  const [localData, setLocalData] = useState<AcademicArchive>(initialData);
  const [remoteSha, setRemoteSha] = useState(initialSha);
  const [isDirty, setIsDirty] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [editor, setEditor] = useState<EditorState>({ kind: 'closed' });
  const [file, setFile] = useState<File | null>(null);
  const [formErrors, setFormErrors] = useState<AssetFormErrors>({});
  const [deleteAssetId, setDeleteAssetId] = useState<string | null>(null);
  const [pageStatus, setPageStatus] = useState<PageStatus>(null);
  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);
  const [expandedActivityId, setExpandedActivityId] = useState<string | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<string | null>(null);

  const years = localData?.years ?? [];
  const modules = localData?.modules ?? [];
  const activities = localData?.activities ?? [];
  const assets = localData?.assets ?? [];
  const orderedYears = [...years].sort((left, right) => left.order - right.order);
  const orderedModules = sortModules(modules, orderedYears);
  const orderedActivities = [...activities].sort((left, right) => {
    const leftModule = orderedModules.find((module) => module.id === left.moduleId);
    const rightModule = orderedModules.find((module) => module.id === right.moduleId);
    return (leftModule?.yearId ?? '').localeCompare(rightModule?.yearId ?? '')
      || (leftModule?.order ?? 0) - (rightModule?.order ?? 0)
      || left.order - right.order;
  });
  const orderedAssets = sortAssets(assets, activities);
  const activityMap = new Map(activities.map((activity) => [activity.id, activity]));
  const moduleMap = new Map(modules.map((module) => [module.id, module]));
  const yearMap = new Map(years.map((year) => [year.id, year]));
  const activityPendingDelete = deleteAssetId ? assets.find((asset) => asset.id === deleteAssetId) : undefined;
  const editedAsset = editor.kind === 'edit' ? assets.find((asset) => asset.id === editor.assetId) : undefined;

  function applyData(data: AcademicArchive, sha: string) {
    const normalized = { ...data, assets: data.assets ?? [], modules: data.modules ?? [], activities: data.activities ?? [] };
    replaceArchive(normalized, sha);
    setRemoteData(normalized);
    setLocalData(normalized);
    setRemoteSha(sha);
    setIsDirty(false);
    setEditor({ kind: 'closed' });
    setFile(null);
    setDeleteAssetId(null);
    setFormErrors({});
    setPageStatus(null);
    setExpandedModuleId(null);
    setExpandedActivityId(null);
  }

  useEffect(() => () => onUnsavedChanges(false), [onUnsavedChanges]);

  useEffect(() => { onUnsavedChanges(isDirty); }, [isDirty, onUnsavedChanges]);
  useEffect(() => {
    if (pageStatus?.kind !== 'success') return undefined;
    const timer = window.setTimeout(() => setPageStatus(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [pageStatus]);

  function openCreateEditor(activityId = orderedActivities[0]?.id) {
    const activity = orderedActivities.find((item) => item.id === activityId);
    if (!activity || isBusy || isDirty) return;
    const module = moduleMap.get(activity.moduleId);
    setEditor({ kind: 'create', values: { ...EMPTY_FORM, activityId: activity.id, order: String(nextAssetOrder(assets, activity.id)) } });
    setFile(null);
    setFormErrors({});
    setPageStatus(null);
    if (!module) return;
  }

  function openEditEditor(asset: Asset) {
    setEditor({ kind: 'edit', assetId: asset.id, values: { activityId: asset.activityId, name: asset.name, order: String(asset.order), visibility: asset.visibility } });
    setFile(null);
    setFormErrors({});
    setPageStatus(null);
  }

  function closeEditor() {
    setEditor({ kind: 'closed' });
    setFile(null);
    setFormErrors({});
  }

  function updateField(field: keyof AssetFormValues, value: string) {
    setEditor((current) => current.kind === 'closed' ? current : { ...current, values: { ...current.values, [field]: value } });
    setFormErrors((current) => ({ ...current, [field]: undefined }));
  }

  function changeFile(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!nextFile) return;
    const nameError = validateAssetName(nextFile.name);
    if (nameError) {
      setFormErrors((current) => ({ ...current, file: nameError }));
      setPageStatus({ kind: 'validation', message: nameError });
      return;
    }
    setFormErrors((current) => ({ ...current, file: undefined, name: undefined }));
    setFile(nextFile);
    if (editor.kind === 'create') updateField('name', nextFile.name);
  }

  function changeYear(yearId: string) {
    const yearModules = orderedModules.filter((module) => module.yearId === yearId);
    const moduleId = yearModules[0]?.id ?? '';
    const activityId = orderedActivities.find((activity) => activity.moduleId === moduleId)?.id ?? '';
    changeActivity(activityId);
  }

  function changeModule(moduleId: string) {
    const activityId = orderedActivities.find((activity) => activity.moduleId === moduleId)?.id ?? '';
    changeActivity(activityId);
  }

  function changeActivity(activityId: string) {
    setEditor((current) => current.kind === 'closed' ? current : {
      ...current,
      values: {
        ...current.values,
        activityId,
        order: activityId === current.values.activityId ? current.values.order : String(nextAssetOrder(assets, activityId)),
      },
    });
    setFormErrors((current) => ({ ...current, activityId: undefined, order: undefined }));
  }

  async function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!localData || editor.kind === 'closed' || isBusy) return;
    const validation = validateAssetForm(editor.values, activities);
    const errors = { ...validation.errors };
    if (editor.kind === 'create' && !file) errors.file = 'Choose a file to upload.';
    if (editor.kind === 'create' && file && file.name.trim() !== validation.values.name) errors.name = 'The display name must match the uploaded file name.';
    if (editor.kind === 'edit' && editedAsset && validateAssetName(validation.values.name) === undefined) {
      const selectedType = fileTypeFromName(validation.values.name);
      const currentType = editedAsset.type;
      if (selectedType !== currentType) errors.name = `Keep the ${editedAsset.type} extension; use Replace to change file content.`;
    }
    setFormErrors(errors);
    if (Object.keys(errors).length) {
      setPageStatus({ kind: 'validation', message: 'Please correct the highlighted fields.' });
      return;
    }

    if (editor.kind === 'create' && file) {
      setIsBusy(true);
      setPageStatus(null);
      try {
        const result = await adminApi.uploadAsset(file, validation.values);
        if (!result.asset) throw new AdminApiRequestError('The Admin API did not return the uploaded asset.', 502, 'INVALID_ASSET_RESPONSE');
        applyData({ ...localData, assets: [...(localData.assets ?? []), result.asset] }, result.contentSha);
        setPageStatus({ kind: 'success', message: 'File uploaded and asset metadata saved.' });
      } catch (error) {
        if (error instanceof AdminApiRequestError && error.status === 401) onRequireLogin();
        else setPageStatus({ kind: error instanceof AdminApiRequestError && error.status === 409 ? 'conflict' : 'error', message: error instanceof Error ? error.message : 'Unable to upload this file.' });
      } finally {
        setIsBusy(false);
      }
      return;
    }

    if (!editedAsset || !localData) return;
    const updatedAsset: Asset = { ...editedAsset, ...validation.values };
    const nextAssets = assets.map((asset) => asset.id === updatedAsset.id ? updatedAsset : asset);
    setLocalData({ ...localData, assets: nextAssets });
    setIsDirty(true);
    setPageStatus(null);
    closeEditor();
  }

  function move(assetId: string, offset: -1 | 1) {
    if (isBusy || isDirty) return;
    const nextAssets = moveAsset(assets, assetId, offset);
    if (nextAssets === assets) return;
    setLocalData((current) => current ? { ...current, assets: nextAssets } : current);
    setIsDirty(true);
    setPageStatus(null);
  }

  async function saveChanges() {
    if (!localData || !remoteSha || !isDirty || isBusy) return;
    setIsBusy(true);
    setPageStatus(null);
    try {
      const nextData = { ...localData, assets };
      const result = await adminApi.updateData(nextData, remoteSha, 'Update academic file assets');
      applyData(result.data, result.contentSha);
      setIsDirty(false);
      setPageStatus({ kind: 'success', message: 'Asset metadata saved successfully.' });
    } catch (error) {
      if (error instanceof AdminApiRequestError && error.status === 401) onRequireLogin();
      else setPageStatus({ kind: error instanceof AdminApiRequestError && error.status === 409 ? 'conflict' : 'error', message: error instanceof Error ? error.message : 'Unable to save asset metadata.' });
    } finally {
      setIsBusy(false);
    }
  }

  async function reloadData() {
    if (isDirty && !window.confirm(t('Reloading will discard unsaved changes. Continue?'))) return;
    setIsBusy(true);
    setPageStatus(null);
    try {
      const result = await refresh();
      applyData(result.data, result.sha);
      setLoadState('ready');
    } catch (error) {
      if (error instanceof AdminApiRequestError && error.status === 401) onRequireLogin();
      else setPageStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to reload files.' });
    } finally {
      setIsBusy(false);
    }
  }

  function discardChanges() {
    if (!remoteData) return;
    setLocalData(remoteData);
    setIsDirty(false);
    setEditor({ kind: 'closed' });
    setPageStatus(null);
  }

  async function replaceSelectedFile(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] ?? null;
    event.target.value = '';
    const assetId = replaceTarget.current;
    replaceTarget.current = null;
    if (!selectedFile || !assetId) return;
    const currentAsset = assets.find((asset) => asset.id === assetId);
    if (!currentAsset || validateAssetName(selectedFile.name)) {
      setPageStatus({ kind: 'validation', message: 'Choose a supported document, archive, or source-code file to replace this asset.' });
      return;
    }
    setIsBusy(true);
    setPageStatus(null);
    try {
      const result = await adminApi.replaceAsset(assetId, selectedFile);
      if (!result.asset) throw new AdminApiRequestError('The Admin API did not return the replaced asset.', 502, 'INVALID_ASSET_RESPONSE');
      applyData({ ...localData!, assets: assets.map((asset) => asset.id === result.asset?.id ? result.asset! : asset) }, result.contentSha);
      setPageStatus({ kind: 'success', message: result.cleanupPending ? 'Replacement saved; the old repository file still needs cleanup.' : 'File replaced successfully.' });
    } catch (error) {
      if (error instanceof AdminApiRequestError && error.status === 401) onRequireLogin();
      else setPageStatus({ kind: error instanceof AdminApiRequestError && error.status === 409 ? 'conflict' : 'error', message: error instanceof Error ? error.message : 'Unable to replace this file.' });
    } finally {
      setIsBusy(false);
    }
  }

  async function confirmDelete() {
    if (!activityPendingDelete || isBusy) return;
    setIsBusy(true);
    setPageStatus(null);
    try {
      const result = await adminApi.deleteAsset(activityPendingDelete.id);
      applyData({ ...localData!, assets: assets.filter((asset) => asset.id !== result.id) }, result.contentSha);
      setPageStatus({ kind: 'success', message: 'File and asset metadata deleted.' });
    } catch (error) {
      if (error instanceof AdminApiRequestError && error.status === 401) onRequireLogin();
      else setPageStatus({ kind: error instanceof AdminApiRequestError && error.status === 409 ? 'conflict' : 'error', message: error instanceof Error ? error.message : 'Unable to delete this file.' });
    } finally {
      setIsBusy(false);
    }
  }

  if (loadState === 'loading') return <AdminPageContainer><LoadingState label={t('Loading files and assets...')} /></AdminPageContainer>;
  if (loadState === 'error' || !localData || !remoteData) {
    return <AdminPageContainer><div className="assets-page-content"><AssetsPageHeader /><div className="assets-error-state" role="alert"><p>{t('GitHub data could not be loaded.')}</p><Button disabled={isBusy} onClick={() => { void reloadData(); }}>{t('Reload Current Data')}</Button></div></div></AdminPageContainer>;
  }

  const assetsByActivity = new Map(orderedActivities.map((activity) => [
    activity.id,
    orderedAssets.filter((asset) => asset.activityId === activity.id),
  ]));
  const selectedActivity = activityMap.get(editor.kind === 'closed' ? '' : editor.values.activityId);
  const selectedModule = selectedActivity ? moduleMap.get(selectedActivity.moduleId) : undefined;
  const selectedYear = selectedModule ? yearMap.get(selectedModule.yearId) : undefined;
  const activityOptionsByModule = new Map<string, Activity[]>(orderedModules.map((module) => [module.id, orderedActivities.filter((activity) => activity.moduleId === module.id)]));

  return (
    <AdminPageContainer>
      <div className="assets-page-content">
        <AssetsPageHeader />
        {orderedActivities.length === 0 ? (
          <Card className="assets-empty-state">
            <h3>{t('No activities available')}</h3>
            <p>{t('Create an activity before uploading an academic file.')}</p>
          </Card>
        ) : (
          <section aria-label={t('Files and assets grouped by Module and Activity')} className="assets-module-groups">
            {orderedModules.map((module) => {
              const moduleActivities = activityOptionsByModule.get(module.id) ?? [];
              const moduleAssets = moduleActivities.reduce((count, activity) => count + (assetsByActivity.get(activity.id)?.length ?? 0), 0);
              const yearName = yearMap.get(module.yearId)?.name ?? t('Academic year');
              return (
                <AnimatedDisclosure
                  count={moduleAssets}
                  countLabel={moduleAssets === 1 ? t('file') : t('files')}
                  expanded={expandedModuleId === module.id}
                  icon={<BookOpen aria-hidden="true" size={20} />}
                  id={`assets-module-${module.id}`}
                  key={module.id}
                  metadata={`${module.code} · ${yearName}`}
                  onToggle={() => {
                    setExpandedModuleId((current) => current === module.id ? null : module.id);
                    setExpandedActivityId(null);
                  }}
                  title={module.name}
                >
                  {moduleActivities.length === 0 ? <p className="assets-hierarchy-empty">{t('No Activities in this Module.')}</p> : (
                    <div className="assets-activity-groups">
                      {moduleActivities.map((activity) => {
                        const activityAssets = assetsByActivity.get(activity.id) ?? [];
                        return (
                          <AnimatedDisclosure
                            actions={<Button disabled={isBusy || isDirty} onClick={() => openCreateEditor(activity.id)} variant="quiet"><Plus aria-hidden="true" size={14} />{t('Add File')}</Button>}
                            count={activityAssets.length}
                            countLabel={activityAssets.length === 1 ? t('file') : t('files')}
                            expanded={expandedActivityId === activity.id}
                            icon={<ClipboardList aria-hidden="true" size={18} />}
                            id={`assets-activity-${activity.id}`}
                            key={activity.id}
                            metadata={t(activity.type.charAt(0).toUpperCase() + activity.type.slice(1))}
                            onToggle={() => setExpandedActivityId((current) => current === activity.id ? null : activity.id)}
                            title={activity.title}
                          >
                            {activityAssets.length === 0 ? <p className="assets-hierarchy-empty">{t('No files attached to this Activity yet.')}</p> : (
                              <div className="assets-list">
                                {activityAssets.map((asset, assetIndex) => {
                                  const Icon = TYPE_ICONS[asset.type];
                                  return (
                                    <article className="asset-row ui-card" key={asset.id}>
                                      <div className="asset-row-main">
                                        <div className="asset-row-heading"><Icon aria-hidden="true" size={19} /><h3>{asset.name}</h3><span className="asset-type-badge">{asset.type}</span></div>
                                        <div className="asset-row-meta">
                                          <span>{t('Order')} {asset.order}</span>
                                          <span>{asset.visibility === 'public' ? <Eye aria-hidden="true" size={14} /> : <EyeOff aria-hidden="true" size={14} />}{t(VISIBILITY_LABELS[asset.visibility])}</span>
                                          <code>{asset.path}</code>
                                        </div>
                                      </div>
                                      <div className="asset-row-actions">
                                        <Button aria-label={`${t('Move Up')} ${asset.name}`} disabled={isBusy || isDirty || assetIndex === 0} onClick={() => move(asset.id, -1)} variant="quiet"><ArrowUp aria-hidden="true" size={16} /></Button>
                                        <Button aria-label={`${t('Move Down')} ${asset.name}`} disabled={isBusy || isDirty || assetIndex === activityAssets.length - 1} onClick={() => move(asset.id, 1)} variant="quiet"><ArrowDown aria-hidden="true" size={16} /></Button>
                                        <Button aria-label={`${t('Edit')} ${asset.name} ${t('metadata')}`} disabled={isBusy || isDirty} onClick={() => openEditEditor(asset)} variant="quiet"><Pencil aria-hidden="true" size={16} /></Button>
                                        <Button aria-label={`${t('Replace')} ${asset.name}`} disabled={isBusy || isDirty} onClick={() => { replaceTarget.current = asset.id; replaceInput.current?.click(); }} variant="quiet"><Replace aria-hidden="true" size={16} /></Button>
                                        <Button aria-label={`${t('Delete')} ${asset.name}`} disabled={isBusy || isDirty} onClick={() => setDeleteAssetId(asset.id)} variant="quiet"><Trash2 aria-hidden="true" size={16} /></Button>
                                      </div>
                                    </article>
                                  );
                                })}
                              </div>
                            )}
                          </AnimatedDisclosure>
                        );
                      })}
                    </div>
                  )}
                </AnimatedDisclosure>
              );
            })}
          </section>
        )}

        <div className="assets-save-area">
          <span className="assets-dirty-state" role="status">{isDirty ? t('Unsaved changes') : ''}</span>
          <div className="assets-page-actions">
            <Button disabled={!isDirty || isBusy} onClick={discardChanges}>{t('Discard Changes')}</Button>
            <Button disabled={isBusy} onClick={() => { void reloadData(); }}>{isBusy ? t('Working...') : t('Reload Current Data')}</Button>
            <Button disabled={!isDirty || isBusy} onClick={() => { void saveChanges(); }} variant="primary">{isBusy ? t('Saving...') : t('Save Changes')}</Button>
          </div>
        </div>
        <div aria-live="polite" className={`assets-save-status${pageStatus ? ` is-${pageStatus.kind}` : ''}`}>{pageStatus && <p role={pageStatus.kind === 'success' ? 'status' : 'alert'}>{t(pageStatus.message)}</p>}</div>
      </div>

      <input ref={replaceInput} className="assets-file-input-hidden" accept={ASSET_FILE_ACCEPT} type="file" onChange={(event) => { void replaceSelectedFile(event); }} />
      <Modal open={editor.kind !== 'closed'} title={t(editor.kind === 'edit' ? 'Edit File Metadata' : 'Add File')} onClose={closeEditor} className="asset-editor-modal">
        {editor.kind !== 'closed' && (
          <form className="asset-editor-form" noValidate onSubmit={(event) => { void submitEditor(event); }}>
            <AssetHierarchyFields
              activities={orderedActivities}
              modules={orderedModules}
              years={orderedYears}
              activityOptionsByModule={activityOptionsByModule}
              activityId={editor.values.activityId}
              disabled={isBusy}
              onYearChange={changeYear}
              onModuleChange={changeModule}
              onActivityChange={changeActivity}
            />
            {selectedYear && selectedModule && selectedActivity && <p className="asset-hierarchy-summary">{selectedYear.name} / {selectedModule.name} / {selectedActivity.title}</p>}
            {editor.kind === 'create' && <div className="asset-form-field"><label htmlFor="asset-file">{t('File')}</label><input id="asset-file" accept={ASSET_FILE_ACCEPT} type="file" onChange={changeFile} />{file && <small>{file.name} · {(file.size / 1024).toFixed(0)} KB</small>}{formErrors.file && <small className="asset-form-error">{t(formErrors.file)}</small>}</div>}
            <AssetField label="File name" error={formErrors.name}><input maxLength={255} value={editor.values.name} onChange={(event) => updateField('name', event.target.value)} /></AssetField>
            <AssetField label="Order" error={formErrors.order}><input min="1" max="1000000" step="1" type="number" value={editor.values.order} onChange={(event) => updateField('order', event.target.value)} /></AssetField>
            <AssetField label="Visibility" error={formErrors.visibility}><select value={editor.values.visibility} onChange={(event) => updateField('visibility', event.target.value)}>{Object.entries(VISIBILITY_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></AssetField>
            <div className="asset-editor-actions"><Button disabled={isBusy} onClick={closeEditor}>{t('Cancel')}</Button><Button disabled={isBusy} type="submit" variant="primary">{isBusy ? t('Uploading...') : editor.kind === 'edit' ? t('Apply Metadata') : t('Upload File')}</Button></div>
          </form>
        )}
      </Modal>
      <Modal open={activityPendingDelete !== undefined} title={t('Delete File?')} onClose={() => setDeleteAssetId(null)} className="admin-confirm-dialog">
        <p className="admin-confirm-message">{t('This removes {file} from the repository and its asset record from data.json.', { file: activityPendingDelete?.name ?? t('the file') })}</p>
        <div className="admin-confirm-actions"><Button disabled={isBusy} onClick={() => setDeleteAssetId(null)}>{t('Cancel')}</Button><Button disabled={isBusy} onClick={() => { void confirmDelete(); }} variant="primary">{isBusy ? t('Deleting...') : t('Delete File')}</Button></div>
      </Modal>
    </AdminPageContainer>
  );
}

function nextAssetOrder(assets: Asset[], activityId: string) {
  return assets.filter((asset) => asset.activityId === activityId).reduce((maximum, asset) => Math.max(maximum, asset.order), 0) + 1;
}

function AssetsPageHeader() {
  const { t } = useLocale();
  return <header className="assets-page-header"><h2>{t('Files & Assets')}</h2><p>{t('Manage repository files attached to academic activities.')}</p></header>;
}

function AssetField({ label, error, children }: { label: string; error?: string; children: React.ReactElement }) {
  const { t } = useLocale();
  const id = `asset-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return <div className="asset-form-field"><label htmlFor={id}>{t(label)}</label>{children.props.id ? children : <AssetFieldControl id={id} error={error}>{children}</AssetFieldControl>}{error && <small className="asset-form-error" id={`${id}-error`}>{t(error)}</small>}</div>;
}

function AssetFieldControl({ id, error, children }: { id: string; error?: string; children: React.ReactElement }) {
  return <>{children.type === 'input'
    ? <input {...children.props} id={id} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? `${id}-error` : undefined} />
    : <select {...children.props} id={id} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? `${id}-error` : undefined} />}</>;
}

function AssetHierarchyFields({
  activities,
  modules,
  years,
  activityOptionsByModule,
  activityId,
  disabled,
  onYearChange,
  onModuleChange,
  onActivityChange,
}: {
  activities: Activity[];
  modules: Module[];
  years: AcademicArchive['years'];
  activityOptionsByModule: Map<string, Activity[]>;
  activityId: string;
  disabled: boolean;
  onYearChange: (yearId: string) => void;
  onModuleChange: (moduleId: string) => void;
  onActivityChange: (activityId: string) => void;
}) {
  const activity = activities.find((item) => item.id === activityId);
  const module = modules.find((item) => item.id === activity?.moduleId);
  const selectedYearId = module?.yearId ?? years[0]?.id ?? '';
  const yearModules = modules.filter((item) => item.yearId === selectedYearId);
  const selectedModuleId = module?.id ?? yearModules[0]?.id ?? '';
  const moduleActivities = activityOptionsByModule.get(selectedModuleId) ?? [];
  return <div className="asset-hierarchy-fields">
    <AssetField label="Academic Year"><select disabled={disabled} value={selectedYearId} onChange={(event) => onYearChange(event.target.value)}>{years.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select></AssetField>
    <AssetField label="Module"><select disabled={disabled} value={selectedModuleId} onChange={(event) => onModuleChange(event.target.value)}>{yearModules.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></AssetField>
    <AssetField label="Activity"><select disabled={disabled} value={activityId} onChange={(event) => onActivityChange(event.target.value)}>{moduleActivities.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></AssetField>
  </div>;
}

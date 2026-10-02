import { useEffect, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { AdminApiRequestError, adminApi } from '../services/adminApi';
import type { AcademicArchive, Module, Visibility } from '../../../types/academic';
import { AnimatedModuleAccordion } from '../components/AnimatedModuleAccordion';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { LoadingState } from '../../../components/ui/LoadingState';
import { Modal } from '../../../components/ui/Modal';
import { AdminPageContainer } from '../components/AdminPageContainer';
import { useLocale } from '../../../app/i18n/LocaleProvider';
import { professorUrlsFromTokens, useAdminData } from '../data/AdminDataProvider';
import {
  MODULE_VISIBILITY_OPTIONS,
  deleteModuleCascade,
  moveModule,
  nextModuleOrder,
  normalizeModuleOrders,
  placeModule,
  sortModules,
  validateModuleForm,
  type ModuleFormErrors,
  type ModuleFormValues,
} from '../modules/modules';

type EditorState =
  | { kind: 'closed' }
  | { kind: 'create'; values: ModuleFormValues }
  | { kind: 'edit'; moduleId: string; values: ModuleFormValues };
type PageStatus = { kind: 'success' | 'error' | 'conflict' | 'validation'; message: string } | null;

interface ModulesPageProps {
  onRequireLogin: () => void;
  onUnsavedChanges: (hasChanges: boolean) => void;
}

const EMPTY_FORM: ModuleFormValues = {
  yearId: '',
  code: '',
  name: '',
  description: '',
  order: '1',
  visibility: 'private',
};

const VISIBILITY_LABELS: Record<Visibility, string> = {
  public: 'Public',
  private: 'Private',
  unlisted: 'Unlisted',
};

export function ModulesPage({ onRequireLogin, onUnsavedChanges }: ModulesPageProps) {
  const { t } = useLocale();
  const { data: initialData, sha: initialSha, professorUrls: initialProfessorUrls, refresh, replaceArchive } = useAdminData();
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('ready');
  const [remoteData, setRemoteData] = useState<AcademicArchive>(initialData);
  const [localData, setLocalData] = useState<AcademicArchive>(initialData);
  const [remoteSha, setRemoteSha] = useState(initialSha);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [editor, setEditor] = useState<EditorState>({ kind: 'closed' });
  const [formErrors, setFormErrors] = useState<ModuleFormErrors>({});
  const [deleteModuleId, setDeleteModuleId] = useState<string | null>(null);
  const [reloadConfirmation, setReloadConfirmation] = useState(false);
  const [pageStatus, setPageStatus] = useState<PageStatus>(null);
  const [professorUrls, setProfessorUrls] = useState<Record<string, string>>(initialProfessorUrls);
  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);
  const [menuModuleId, setMenuModuleId] = useState<string | null>(null);

  const isBusy = isSaving || isReloading;
  const years = localData?.years ?? [];
  const modules = localData?.modules ?? [];
  const orderedYears = [...years].sort((left, right) => left.order - right.order);
  const orderedModules = sortModules(modules, orderedYears);
  const editedModule = editor.kind === 'edit' ? modules.find((module) => module.id === editor.moduleId) : undefined;
  const modulePendingDelete = deleteModuleId ? modules.find((module) => module.id === deleteModuleId) : undefined;

  function applyLoadedData(data: AcademicArchive, sha: string, urls?: Record<string, string>) {
    const loadedData = { ...data, modules: data.modules ?? [] };
    replaceArchive(loadedData, sha);
    setRemoteData(loadedData);
    setLocalData(loadedData);
    setRemoteSha(sha);
    setIsDirty(false);
    setEditor({ kind: 'closed' });
    setFormErrors({});
    setDeleteModuleId(null);
    setReloadConfirmation(false);
    setPageStatus(null);
    if (urls) setProfessorUrls(urls);
    setExpandedModuleId(null);
    setMenuModuleId(null);
  }

  useEffect(() => () => onUnsavedChanges(false), [onUnsavedChanges]);

  useEffect(() => {
    onUnsavedChanges(isDirty);
  }, [isDirty, onUnsavedChanges]);

  useEffect(() => {
    if (pageStatus?.kind !== 'success') return undefined;
    const timer = window.setTimeout(() => setPageStatus(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [pageStatus]);

  function setModules(nextModules: Module[]) {
    setLocalData((current) => current ? { ...current, modules: nextModules } : current);
    setIsDirty(true);
    setPageStatus(null);
  }

  function openCreateEditor() {
    if (orderedYears.length === 0) return;
    const yearId = orderedYears[0]!.id;
    setEditor({
      kind: 'create',
      values: { ...EMPTY_FORM, yearId, order: String(nextModuleOrder(modules, yearId)) },
    });
    setFormErrors({});
    setPageStatus(null);
  }

  function openEditEditor(module: Module) {
    setEditor({
      kind: 'edit',
      moduleId: module.id,
      values: {
        yearId: module.yearId,
        code: module.code,
        name: module.name,
        description: module.description ?? '',
        order: String(module.order),
        visibility: module.visibility,
      },
    });
    setFormErrors({});
    setPageStatus(null);
  }

  function closeEditor() {
    setEditor({ kind: 'closed' });
    setFormErrors({});
  }

  function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!localData || editor.kind === 'closed' || isBusy) return;

    const validation = validateModuleForm(editor.values, years);
    setFormErrors(validation.errors);
    if (!validation.valid) {
      setPageStatus({ kind: 'validation', message: 'Please correct the highlighted fields.' });
      return;
    }

    const id = editor.kind === 'edit' ? editor.moduleId : crypto.randomUUID();
    const nextModule: Module = {
      ...(editor.kind === 'edit' ? editedModule : undefined),
      id,
      ...validation.values,
    };
    setModules(placeModule(modules, nextModule, years));
    closeEditor();
  }

  function requestDelete(moduleId: string) {
    setDeleteModuleId(moduleId);
    setPageStatus(null);
  }

  function confirmDelete() {
    if (!localData || !modulePendingDelete || isBusy) return;
    setLocalData(deleteModuleCascade(localData, modulePendingDelete.id));
    setIsDirty(true);
    setDeleteModuleId(null);
    setPageStatus(null);
  }

  function toggleProfessorLink(linkId: string) {
    setLocalData((current) => current ? {
      ...current,
      isolatedLinks: (current.isolatedLinks ?? []).map((link) => link.id === linkId
        ? { ...link, status: link.status === 'active' ? 'revoked' : 'active' }
        : link),
    } : current);
    setIsDirty(true);
    setPageStatus(null);
  }

  async function copyProfessorLink(linkId: string) {
    const url = professorUrls[linkId];
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setPageStatus({ kind: 'success', message: 'Professor Link copied.' });
    } catch {
      setPageStatus({ kind: 'error', message: 'Clipboard access is unavailable.' });
    }
  }

  function move(moduleId: string, offset: -1 | 1) {
    if (isBusy) return;
    const nextModules = moveModule(modules, moduleId, offset);
    if (nextModules === modules) return;
    setModules(nextModules);
  }

  async function saveChanges() {
    if (!localData || !isDirty || isBusy || !remoteSha) return;
    const nextData = { ...localData, modules: normalizeModuleOrders(modules, years) };
    setLocalData(nextData);
    setIsSaving(true);
    setPageStatus(null);
    try {
      const result = await adminApi.updateData(nextData, remoteSha, 'Update academic modules');
      applyLoadedData(result.data, result.contentSha, professorUrlsFromTokens(result.links));
      setPageStatus({ kind: 'success', message: 'Modules saved successfully.' });
    } catch (error) {
      if (error instanceof AdminApiRequestError && error.status === 401) {
        onRequireLogin();
        return;
      }
      if (error instanceof AdminApiRequestError && error.status === 409) {
        setPageStatus({ kind: 'conflict', message: 'Academic data changed on GitHub. Reload the current version before saving.' });
      } else if (error instanceof AdminApiRequestError && error.code.startsWith('GITHUB_')) {
        setPageStatus({ kind: 'error', message: error.message });
      } else if (error instanceof AdminApiRequestError && error.code === 'DATA_VALIDATION_FAILED') {
        setPageStatus({ kind: 'validation', message: error.message });
      } else {
        setPageStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to save modules.' });
      }
    } finally {
      setIsSaving(false);
    }
  }

  function requestReload() {
    if (isDirty) {
      setReloadConfirmation(true);
      return;
    }
    void reloadData();
  }

  async function reloadData() {
    setReloadConfirmation(false);
    setIsReloading(true);
    setPageStatus(null);
    try {
      const result = await refresh();
      applyLoadedData(result.data, result.sha, result.professorUrls);
      setLoadState('ready');
    } catch (error) {
      if (error instanceof AdminApiRequestError && error.status === 401) {
        onRequireLogin();
        return;
      }
      setPageStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to reload modules.' });
    } finally {
      setIsReloading(false);
    }
  }

  function discardChanges() {
    if (!remoteData) return;
    setLocalData(remoteData);
    setIsDirty(false);
    setEditor({ kind: 'closed' });
    setDeleteModuleId(null);
    setFormErrors({});
    setPageStatus(null);
  }

  if (loadState === 'loading') {
    return <AdminPageContainer><LoadingState label={t('Loading modules...')} /></AdminPageContainer>;
  }

  if (loadState === 'error' || !localData || !remoteData) {
    return (
      <AdminPageContainer>
        <div className="modules-page-content">
          <ModulesPageHeader />
          <div className="modules-error-state" role="alert">
            <p>{t('GitHub data could not be loaded.')}</p>
            <Button disabled={isReloading} onClick={requestReload}>{isReloading ? t('Reloading...') : t('Reload Current Data')}</Button>
          </div>
        </div>
      </AdminPageContainer>
    );
  }

  const yearName = new Map(years.map((year) => [year.id, year.name]));
  const modalOpen = editor.kind !== 'closed';

  return (
    <AdminPageContainer>
      <div className="modules-page-content">
        <ModulesPageHeader />

        {years.length === 0 ? (
          <Card className="modules-empty-state">
            <h3>{t('No academic years available')}</h3>
            <p>{t('Create an academic year before adding modules.')}</p>
          </Card>
        ) : orderedModules.length === 0 ? (
          <Card className="modules-empty-state">
            <h3>{t('No modules yet')}</h3>
            <p>{t('Add the first module to an existing academic year.')}</p>
            <Button disabled={isBusy} onClick={openCreateEditor} variant="primary"><Plus aria-hidden="true" size={17} />{t('Add Module')}</Button>
          </Card>
        ) : (
          <section aria-label={t('Modules list')} className="modules-list">
            {orderedModules.map((module) => {
              const sameYear = orderedModules.filter((item) => item.yearId === module.yearId);
              const index = sameYear.findIndex((item) => item.id === module.id);
              const moduleActivities = (localData.activities ?? []).filter((activity) => activity.moduleId === module.id).sort((left, right) => left.order - right.order);
              const professorLink = localData.isolatedLinks?.find((link) => link.purpose === 'primary-professor' && link.scopeType === 'module' && link.scopeId === module.id);
              const savedLink = professorLink ? remoteData.isolatedLinks?.find((link) => link.id === professorLink.id) : undefined;
              const activityLinks = moduleActivities.map((activity) => {
                const link = localData.isolatedLinks?.find((item) => item.purpose === 'primary-professor' && item.scopeType === 'activity' && item.scopeId === activity.id);
                const savedActivityLink = link ? remoteData.isolatedLinks?.find((item) => item.id === link.id) : undefined;
                return {
                  activity,
                  link,
                  url: link ? professorUrls[link.id] : undefined,
                  pending: Boolean(savedActivityLink && savedActivityLink.status !== link?.status),
                };
              });
              return (
                <AnimatedModuleAccordion
                  key={module.id}
                  module={module}
                  activities={activityLinks}
                  expanded={expandedModuleId === module.id}
                  menuOpen={menuModuleId === module.id}
                  canMoveUp={index > 0}
                  canMoveDown={index < sameYear.length - 1}
                  onToggleExpanded={() => {
                    setExpandedModuleId((current) => current === module.id ? null : module.id);
                    setMenuModuleId(null);
                  }}
                  onToggleMenu={() => setMenuModuleId((current) => current === module.id ? null : module.id)}
                  onCloseMenu={() => setMenuModuleId(null)}
                  onDelete={() => requestDelete(module.id)}
                  onEdit={() => openEditEditor(module)}
                  onMoveUp={() => move(module.id, -1)}
                  onMoveDown={() => move(module.id, 1)}
                  moduleLink={professorLink}
                  moduleUrl={professorLink ? professorUrls[professorLink.id] : undefined}
                  moduleLinkPending={Boolean(savedLink && savedLink.status !== professorLink?.status)}
                  onCopyModuleLink={() => professorLink && void copyProfessorLink(professorLink.id)}
                  onToggleModuleLink={() => professorLink && toggleProfessorLink(professorLink.id)}
                  yearName={t(yearName.get(module.yearId) ?? 'Unknown academic year')}
                  disabled={isBusy}
                  onCopyActivityLink={(linkId) => { void copyProfessorLink(linkId); }}
                  onToggleActivityLink={toggleProfessorLink}
                />
              );
            })}
          </section>
        )}

        {years.length > 0 && orderedModules.length > 0 && (
          <div className="modules-add-action">
            <Button disabled={isBusy} onClick={openCreateEditor} variant="primary"><Plus aria-hidden="true" size={17} />{t('Add Module')}</Button>
          </div>
        )}

        <div className="modules-save-area">
          <span className="modules-dirty-state" role="status">{isDirty ? t('Unsaved changes') : ''}</span>
          <div className="modules-page-actions">
            <Button disabled={!isDirty || isBusy} onClick={discardChanges}>{t('Discard Changes')}</Button>
            <Button disabled={isBusy} onClick={requestReload}>{isReloading ? t('Reloading...') : t('Reload Current Data')}</Button>
            <Button disabled={!isDirty || isBusy} onClick={() => { void saveChanges(); }} variant="primary">{isSaving ? t('Saving...') : t('Save Changes')}</Button>
          </div>
        </div>
        <div aria-live="polite" className={`modules-save-status${pageStatus ? ` is-${pageStatus.kind}` : ''}`}>
          {pageStatus && <p role={pageStatus.kind === 'success' ? 'status' : 'alert'}>{t(pageStatus.message)}</p>}
        </div>
      </div>

      <Modal
        open={modalOpen}
        title={t(editor.kind === 'edit' ? 'Edit Module' : 'Add Module')}
        onClose={closeEditor}
        className="module-editor-modal"
      >
        {editor.kind !== 'closed' && (
          <form className="module-editor-form" noValidate onSubmit={submitEditor}>
            <ModuleField label="Academic Year" error={formErrors.yearId}>
              <select aria-invalid={formErrors.yearId ? 'true' : undefined} value={editor.values.yearId} onChange={(event) => {
                const yearId = event.target.value;
                setEditor((current) => current.kind === 'closed' ? current : { ...current, values: { ...current.values, yearId, order: yearId === current.values.yearId ? current.values.order : String(nextModuleOrder(modules, yearId)) } });
                setFormErrors((current) => ({ ...current, yearId: undefined }));
              }}>
                <option value="">{t('Select an academic year')}</option>
                {orderedYears.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}
              </select>
            </ModuleField>
            <ModuleField label="Module Code" error={formErrors.code}>
              <input aria-invalid={formErrors.code ? 'true' : undefined} maxLength={100} value={editor.values.code} onChange={(event) => updateEditorField('code', event.target.value)} />
            </ModuleField>
            <ModuleField label="Module Name" error={formErrors.name}>
              <input aria-invalid={formErrors.name ? 'true' : undefined} maxLength={300} value={editor.values.name} onChange={(event) => updateEditorField('name', event.target.value)} />
            </ModuleField>
            <ModuleField label="Description">
              <textarea maxLength={10_000} rows={4} value={editor.values.description} onChange={(event) => updateEditorField('description', event.target.value)} />
            </ModuleField>
            <ModuleField label="Order" error={formErrors.order}>
              <input aria-invalid={formErrors.order ? 'true' : undefined} min="1" max="1000000" step="1" type="number" value={editor.values.order} onChange={(event) => updateEditorField('order', event.target.value)} />
            </ModuleField>
            <ModuleField label="Visibility" error={formErrors.visibility}>
              <select aria-invalid={formErrors.visibility ? 'true' : undefined} value={editor.values.visibility} onChange={(event) => updateEditorField('visibility', event.target.value)}>
                {MODULE_VISIBILITY_OPTIONS.map((visibility) => <option key={visibility} value={visibility}>{t(VISIBILITY_LABELS[visibility])}</option>)}
              </select>
            </ModuleField>
            <div className="module-editor-actions">
              <Button onClick={closeEditor}>{t('Cancel')}</Button>
              <Button type="submit" variant="primary">{t(editor.kind === 'edit' ? 'Save Module' : 'Add Module')}</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={modulePendingDelete !== undefined} title={t('Delete Module?')} onClose={() => setDeleteModuleId(null)} className="module-editor-modal">
        <p className="module-confirm-message">{t('Delete {module} and its activities, asset records, and isolated links? Uploaded files remain in GitHub storage.', { module: modulePendingDelete?.name ?? t('this module') })}</p>
        <div className="module-editor-actions">
          <Button disabled={isBusy} onClick={() => setDeleteModuleId(null)}>{t('Cancel')}</Button>
          <Button disabled={isBusy} onClick={confirmDelete} variant="primary">{t('Delete Module')}</Button>
        </div>
      </Modal>

      <Modal open={reloadConfirmation} title={t('Reload Current Data')} onClose={() => setReloadConfirmation(false)} className="module-editor-modal">
        <p className="module-confirm-message">{t('Reloading will discard your unsaved changes.')}</p>
        <div className="module-editor-actions">
          <Button onClick={() => setReloadConfirmation(false)}>{t('Cancel')}</Button>
          <Button onClick={() => { void reloadData(); }} variant="primary">{t('Reload')}</Button>
        </div>
      </Modal>
    </AdminPageContainer>
  );

  function updateEditorField(field: keyof ModuleFormValues, value: string) {
    setEditor((current) => current.kind === 'closed' ? current : { ...current, values: { ...current.values, [field]: value } });
    setFormErrors((current) => ({ ...current, [field]: undefined }));
  }
}

function ModulesPageHeader() {
  const { t } = useLocale();
  return (
    <header className="modules-page-header">
      <h2>{t('Modules')}</h2>
      <p>{t('Manage modules within their academic years.')}</p>
    </header>
  );
}

function ModuleField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  const { t } = useLocale();
  const errorId = `module-${label.toLowerCase().replaceAll(' ', '-')}-error`;
  return (
    <div className="module-form-field">
      <label>{t(label)}{children}</label>
      {error && <p className="module-field-error" id={errorId}>{t(error)}</p>}
    </div>
  );
}

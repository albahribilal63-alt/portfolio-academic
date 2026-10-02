import { cloneElement, isValidElement, useEffect, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, ClipboardList, Copy, ExternalLink, Eye, EyeOff, Pencil, Plus, ShieldOff, Trash2 } from 'lucide-react';
import { adminApi, AdminApiRequestError } from '../services/adminApi';
import type { AcademicArchive, Activity, IsolatedLink, Visibility } from '../../../types/academic';
import { AnimatedDisclosure } from '../components/AnimatedModuleAccordion';
import { sortModules } from '../modules/modules';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { LoadingState } from '../../../components/ui/LoadingState';
import { Modal } from '../../../components/ui/Modal';
import { AdminPageContainer } from '../components/AdminPageContainer';
import { useLocale } from '../../../app/i18n/LocaleProvider';
import { professorUrlsFromTokens, useAdminData } from '../data/AdminDataProvider';
import {
  ACTIVITY_TYPE_OPTIONS,
  deleteActivityCascade,
  moveActivity,
  nextActivityOrder,
  normalizeActivityOrders,
  placeActivity,
  sortActivities,
  validateActivityForm,
  type ActivityFormErrors,
  type ActivityFormValues,
} from '../activities/activities';

type EditorState =
  | { kind: 'closed' }
  | { kind: 'create'; values: ActivityFormValues }
  | { kind: 'edit'; activityId: string; values: ActivityFormValues };
type PageStatus = { kind: 'success' | 'error' | 'conflict' | 'validation'; message: string } | null;

interface ActivitiesPageProps {
  onRequireLogin: () => void;
  onUnsavedChanges: (hasChanges: boolean) => void;
}

const EMPTY_FORM: ActivityFormValues = {
  moduleId: '',
  title: '',
  description: '',
  type: 'exercise',
  order: '1',
  visibility: 'private',
};

const VISIBILITY_LABELS: Record<Visibility, string> = {
  public: 'Public',
  private: 'Private',
  unlisted: 'Unlisted',
};

const TYPE_LABELS: Record<Activity['type'], string> = {
  lesson: 'Lesson',
  exercise: 'Exercise',
  project: 'Project',
  quiz: 'Quiz',
  lab: 'Lab',
  workshop: 'Workshop',
  reading: 'Reading',
  other: 'Other',
};

export function ActivitiesPage({ onRequireLogin, onUnsavedChanges }: ActivitiesPageProps) {
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
  const [formErrors, setFormErrors] = useState<ActivityFormErrors>({});
  const [deleteActivityId, setDeleteActivityId] = useState<string | null>(null);
  const [reloadConfirmation, setReloadConfirmation] = useState(false);
  const [pageStatus, setPageStatus] = useState<PageStatus>(null);
  const [professorUrls, setProfessorUrls] = useState<Record<string, string>>(initialProfessorUrls);
  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);

  const isBusy = isSaving || isReloading;
  const modules = localData?.modules ?? [];
  const activities = localData?.activities ?? [];
  const orderedModules = sortModules(modules, localData?.years ?? []);
  const orderedActivities = sortActivities(activities, orderedModules);
  const moduleLookup = new Map(orderedModules.map((module) => [module.id, module]));
  const editedActivity = editor.kind === 'edit' ? activities.find((activity) => activity.id === editor.activityId) : undefined;
  const activityPendingDelete = deleteActivityId ? activities.find((activity) => activity.id === deleteActivityId) : undefined;

  function applyLoadedData(data: AcademicArchive, sha: string, urls?: Record<string, string>) {
    const loadedData = { ...data, modules: data.modules ?? [], activities: data.activities ?? [] };
    replaceArchive(loadedData, sha);
    setRemoteData(loadedData);
    setLocalData(loadedData);
    setRemoteSha(sha);
    setIsDirty(false);
    setEditor({ kind: 'closed' });
    setFormErrors({});
    setDeleteActivityId(null);
    setReloadConfirmation(false);
    setPageStatus(null);
    if (urls) setProfessorUrls(urls);
    setExpandedModuleId(null);
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

  function setActivities(nextActivities: Activity[]) {
    setLocalData((current) => current ? { ...current, activities: nextActivities } : current);
    setIsDirty(true);
    setPageStatus(null);
  }

  function openCreateEditor(moduleId = orderedModules[0]?.id) {
    if (!moduleId || !orderedModules.some((module) => module.id === moduleId)) return;
    setEditor({
      kind: 'create',
      values: {
        ...EMPTY_FORM,
        moduleId,
        order: String(nextActivityOrder(activities, moduleId)),
      },
    });
    setFormErrors({});
    setPageStatus(null);
  }

  function openEditEditor(activity: Activity) {
    const module = moduleLookup.get(activity.moduleId);
    setEditor({
      kind: 'edit',
      activityId: activity.id,
      values: {
        moduleId: activity.moduleId,
        title: activity.title,
        description: activity.description ?? '',
        type: activity.type,
        order: String(activity.order),
        visibility: activity.visibility,
      },
    });
    if (module) {
      setEditor((current) => current.kind === 'closed' ? current : { ...current, values: { ...current.values, moduleId: module.id } });
    }
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

    const validation = validateActivityForm(editor.values, orderedModules);
    setFormErrors(validation.errors);
    if (!validation.valid) {
      setPageStatus({ kind: 'validation', message: 'Please correct the highlighted fields.' });
      return;
    }

    const id = editor.kind === 'edit' ? editor.activityId : crypto.randomUUID();
    const nextActivity: Activity = {
      ...(editor.kind === 'edit' ? editedActivity : undefined),
      id,
      moduleId: validation.values.moduleId,
      title: validation.values.title,
      description: validation.values.description || undefined,
      type: validation.values.type,
      order: validation.values.order,
      visibility: validation.values.visibility,
    };
    setActivities(placeActivity(activities, nextActivity, orderedModules));
    closeEditor();
  }

  function requestDelete(activityId: string) {
    setDeleteActivityId(activityId);
    setPageStatus(null);
  }

  function confirmDelete() {
    if (!activityPendingDelete || !localData || isBusy) return;
    setLocalData(deleteActivityCascade(localData, activityPendingDelete.id));
    setIsDirty(true);
    setDeleteActivityId(null);
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

  function move(activityId: string, offset: -1 | 1) {
    if (isBusy) return;
    const nextActivities = moveActivity(activities, activityId, offset, orderedModules);
    if (nextActivities === activities) return;
    setActivities(nextActivities);
  }

  async function saveChanges() {
    if (!localData || !isDirty || isBusy || !remoteSha) return;
    const nextData = { ...localData, activities: normalizeActivityOrders(activities, orderedModules) };
    setLocalData(nextData);
    setIsSaving(true);
    setPageStatus(null);
    try {
      const result = await adminApi.updateData(nextData, remoteSha, 'Update academic activities');
      applyLoadedData(result.data, result.contentSha, professorUrlsFromTokens(result.links));
      setPageStatus({ kind: 'success', message: 'Activities saved successfully.' });
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
        setPageStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to save activities.' });
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
      setPageStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Unable to reload activities.' });
    } finally {
      setIsReloading(false);
    }
  }

  function discardChanges() {
    if (!remoteData) return;
    setLocalData(remoteData);
    setIsDirty(false);
    setEditor({ kind: 'closed' });
    setDeleteActivityId(null);
    setFormErrors({});
    setPageStatus(null);
  }

  if (loadState === 'loading') {
    return <AdminPageContainer><LoadingState label={t('Loading activities...')} /></AdminPageContainer>;
  }

  if (loadState === 'error' || !localData || !remoteData) {
    return (
      <AdminPageContainer>
        <div className="activities-page-content">
          <ActivitiesPageHeader />
          <div className="activities-error-state" role="alert">
            <p>{t('GitHub data could not be loaded.')}</p>
            <Button disabled={isReloading} onClick={requestReload}>{isReloading ? t('Reloading...') : t('Reload Current Data')}</Button>
          </div>
        </div>
      </AdminPageContainer>
    );
  }

  const modalOpen = editor.kind !== 'closed';

  return (
    <AdminPageContainer>
      <div className="activities-page-content">
        <ActivitiesPageHeader />

        {orderedModules.length === 0 ? (
          <Card className="activities-empty-state">
            <h3>{t('No modules available')}</h3>
            <p>{t('Create a valid module before adding an activity.')}</p>
          </Card>
        ) : (
          <section aria-label={t('Activities grouped by Module')} className="activities-module-groups">
            {orderedModules.map((module) => {
              const moduleActivities = orderedActivities.filter((activity) => activity.moduleId === module.id);
              const yearName = localData.years.find((year) => year.id === module.yearId)?.name ?? t('Academic year');
              return (
                <AnimatedDisclosure
                  actions={<Button disabled={isBusy} onClick={() => openCreateEditor(module.id)} variant="quiet"><Plus aria-hidden="true" size={15} />{t('Add Activity')}</Button>}
                  count={moduleActivities.length}
                  countLabel={moduleActivities.length === 1 ? t('Activity') : t('Activities')}
                  expanded={expandedModuleId === module.id}
                  icon={<ClipboardList aria-hidden="true" size={20} />}
                  id={`activities-module-${module.id}`}
                  key={module.id}
                  metadata={`${module.code} · ${yearName}`}
                  onToggle={() => setExpandedModuleId((current) => current === module.id ? null : module.id)}
                  title={module.name}
                >
                  {moduleActivities.length === 0 ? (
                    <p className="activities-module-empty">{t('No Activities in this Module yet.')}</p>
                  ) : (
                    <div className="activities-module-list">
                      {moduleActivities.map((activity, index) => {
                        const professorLink = localData.isolatedLinks?.find((link) => link.purpose === 'primary-professor' && link.scopeType === 'activity' && link.scopeId === activity.id);
                        const savedLink = professorLink ? remoteData.isolatedLinks?.find((link) => link.id === professorLink.id) : undefined;
                        return (
                          <ActivityRow
                            activity={activity}
                            disabled={isBusy}
                            index={index}
                            key={activity.id}
                            onDelete={() => requestDelete(activity.id)}
                            onEdit={() => openEditEditor(activity)}
                            onMoveDown={() => move(activity.id, 1)}
                            onMoveUp={() => move(activity.id, -1)}
                            professorLink={professorLink}
                            professorUrl={professorLink ? professorUrls[professorLink.id] : undefined}
                            professorLinkPending={Boolean(savedLink && savedLink.status !== professorLink?.status)}
                            onCopyProfessorLink={() => professorLink && void copyProfessorLink(professorLink.id)}
                            onOpenProfessorLink={() => professorLink && professorUrls[professorLink.id] && window.open(professorUrls[professorLink.id], '_blank', 'noopener,noreferrer')}
                            onToggleProfessorLink={() => professorLink && toggleProfessorLink(professorLink.id)}
                            total={moduleActivities.length}
                          />
                        );
                      })}
                    </div>
                  )}
                </AnimatedDisclosure>
              );
            })}
          </section>
        )}

        <div className="activities-save-area">
          <span className="activities-dirty-state" role="status">{isDirty ? t('Unsaved changes') : ''}</span>
          <div className="activities-page-actions">
            <Button disabled={!isDirty || isBusy} onClick={discardChanges}>{t('Discard Changes')}</Button>
            <Button disabled={isBusy} onClick={requestReload}>{isReloading ? t('Reloading...') : t('Reload Current Data')}</Button>
            <Button disabled={!isDirty || isBusy} onClick={() => { void saveChanges(); }} variant="primary">{isSaving ? t('Saving...') : t('Save Changes')}</Button>
          </div>
        </div>
        <div aria-live="polite" className={`activities-save-status${pageStatus ? ` is-${pageStatus.kind}` : ''}`}>
          {pageStatus && <p role={pageStatus.kind === 'success' ? 'status' : 'alert'}>{t(pageStatus.message)}</p>}
        </div>
      </div>

      <Modal
        open={modalOpen}
        title={t(editor.kind === 'edit' ? 'Edit Activity' : 'Add Activity')}
        onClose={closeEditor}
        className="activity-editor-modal"
      >
        {editor.kind !== 'closed' && (
          <form className="activity-editor-form" noValidate onSubmit={submitEditor}>
            <ActivityField label="Module" error={formErrors.moduleId}>
              <select id="activity-module" aria-invalid={formErrors.moduleId ? 'true' : undefined} value={editor.values.moduleId} onChange={(event) => {
                const moduleId = event.target.value;
                setEditor((current) => current.kind === 'closed' ? current : {
                  ...current,
                  values: { ...current.values, moduleId, order: moduleId === current.values.moduleId ? current.values.order : String(nextActivityOrder(activities, moduleId)) },
                });
                setFormErrors((current) => ({ ...current, moduleId: undefined }));
              }}>
                <option value="">{t('Select a module')}</option>
                {orderedModules.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}
              </select>
            </ActivityField>
            <ActivityField label="Activity Title" error={formErrors.title}>
              <input id="activity-title" aria-invalid={formErrors.title ? 'true' : undefined} maxLength={300} value={editor.values.title} onChange={(event) => updateEditorField('title', event.target.value)} />
            </ActivityField>
            <ActivityField label="Description">
              <textarea id="activity-description" maxLength={10_000} rows={4} value={editor.values.description} onChange={(event) => updateEditorField('description', event.target.value)} />
            </ActivityField>
            <ActivityField label="Type" error={formErrors.type}>
              <select id="activity-type" aria-invalid={formErrors.type ? 'true' : undefined} value={editor.values.type} onChange={(event) => updateEditorField('type', event.target.value)}>
                {ACTIVITY_TYPE_OPTIONS.map((type) => <option key={type} value={type}>{t(TYPE_LABELS[type])}</option>)}
              </select>
            </ActivityField>
            <ActivityField label="Order" error={formErrors.order}>
              <input id="activity-order" aria-invalid={formErrors.order ? 'true' : undefined} min="1" max="1000000" step="1" type="number" value={editor.values.order} onChange={(event) => updateEditorField('order', event.target.value)} />
            </ActivityField>
            <ActivityField label="Visibility" error={formErrors.visibility}>
              <select id="activity-visibility" aria-invalid={formErrors.visibility ? 'true' : undefined} value={editor.values.visibility} onChange={(event) => updateEditorField('visibility', event.target.value)}>
                {Object.entries(VISIBILITY_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
              </select>
            </ActivityField>
            <div className="activity-editor-actions">
              <Button onClick={closeEditor}>{t('Cancel')}</Button>
              <Button type="submit" variant="primary">{t(editor.kind === 'edit' ? 'Save Activity' : 'Add Activity')}</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={activityPendingDelete !== undefined} title={t('Delete Activity?')} onClose={() => setDeleteActivityId(null)} className="activity-editor-modal">
        <p className="activity-confirm-message">{t('Delete {activity} from the module?', { activity: activityPendingDelete?.title ?? t('this activity') })}</p>
        <div className="activity-editor-actions">
          <Button disabled={isBusy} onClick={() => setDeleteActivityId(null)}>{t('Cancel')}</Button>
          <Button disabled={isBusy} onClick={confirmDelete} variant="primary">{t('Delete Activity')}</Button>
        </div>
      </Modal>

      <Modal open={reloadConfirmation} title={t('Reload Current Data')} onClose={() => setReloadConfirmation(false)} className="activity-editor-modal">
        <p className="activity-confirm-message">{t('Reloading will discard your unsaved changes.')}</p>
        <div className="activity-editor-actions">
          <Button onClick={() => setReloadConfirmation(false)}>{t('Cancel')}</Button>
          <Button onClick={() => { void reloadData(); }} variant="primary">{t('Reload')}</Button>
        </div>
      </Modal>
    </AdminPageContainer>
  );

  function updateEditorField(field: keyof ActivityFormValues, value: string) {
    setEditor((current) => current.kind === 'closed' ? current : { ...current, values: { ...current.values, [field]: value } });
    setFormErrors((current) => ({ ...current, [field]: undefined }));
  }
}

function ActivitiesPageHeader() {
  const { t } = useLocale();
  return (
    <header className="activities-page-header">
      <h2>{t('Activities')}</h2>
      <p>{t('Manage activities and exercises inside each academic module.')}</p>
    </header>
  );
}

function ActivityField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  const { t } = useLocale();
  const fieldId = `activity-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const errorId = `${fieldId}-error`;
  const childWithProps = isValidElement<{ id?: string; 'aria-invalid'?: 'true' | 'false'; 'aria-describedby'?: string }>(children)
    ? cloneElement(children, {
        id: children.props.id ?? fieldId,
        'aria-invalid': children.props['aria-invalid'] ?? (error ? 'true' : undefined),
        'aria-describedby': error ? errorId : children.props['aria-describedby'],
      })
    : children;

  return (
    <div className="activity-form-field">
      <label htmlFor={fieldId}>{t(label)}</label>
      {childWithProps}
      {error && <small id={errorId} className="activity-form-error">{t(error)}</small>}
    </div>
  );
}

function ActivityRow({
  activity,
  disabled,
  index,
  onDelete,
  onEdit,
  onMoveDown,
  onMoveUp,
  total,
  professorLink,
  professorUrl,
  professorLinkPending,
  onCopyProfessorLink,
  onOpenProfessorLink,
  onToggleProfessorLink,
}: {
  activity: Activity;
  disabled: boolean;
  index: number;
  onDelete: () => void;
  onEdit: () => void;
  onMoveDown: () => void;
  onMoveUp: () => void;
  total: number;
  professorLink?: IsolatedLink;
  professorUrl?: string;
  professorLinkPending: boolean;
  onCopyProfessorLink: () => void;
  onOpenProfessorLink: () => void;
  onToggleProfessorLink: () => void;
}) {
  const { t } = useLocale();
  return (
    <article className="activity-row ui-card">
      <div className="activity-row-main">
        <div className="activity-row-header">
          <h3>{activity.title}</h3>
          <span className="activity-row-type">{t(TYPE_LABELS[activity.type])}</span>
        </div>
        <div className="activity-row-meta">
          <span className="activity-visibility-badge">
            {activity.visibility === 'public' ? <Eye aria-hidden="true" size={14} /> : <EyeOff aria-hidden="true" size={14} />}
            {t(activity.visibility === 'public' ? 'Public' : activity.visibility === 'private' ? 'Private' : 'Unlisted')}
          </span>
          <span className="activity-order-badge">{t('Order')} {activity.order}</span>
        </div>
        {activity.description && <p>{activity.description}</p>}
        <div className="activity-professor-link">
          <strong>{t('Professor Link')}</strong>
          {professorLink ? <>
            <span>{professorLinkPending ? t(professorLink.status === 'active' ? 'Pending Activation' : 'Pending Revocation') : t(professorLink.status === 'active' ? 'Active' : 'Revoked')}</span>
            <Button disabled={disabled || !professorUrl || professorLinkPending} onClick={onCopyProfessorLink} variant="quiet"><Copy aria-hidden="true" size={14} />{t('Copy')}</Button>
            <Button disabled={disabled || !professorUrl || professorLinkPending} onClick={onOpenProfessorLink} variant="quiet"><ExternalLink aria-hidden="true" size={14} />{t('Open')}</Button>
            <Button disabled={disabled} onClick={onToggleProfessorLink} variant="quiet">{professorLink.status === 'active' ? <><ShieldOff aria-hidden="true" size={14} />{t('Revoke')}</> : <><Eye aria-hidden="true" size={14} />{t('Activate')}</>}</Button>
          </> : <span>{t('Provisioned when saved')}</span>}
        </div>
      </div>
      <div className="activity-row-actions">
        <Button aria-label={`${t('Move Up')} ${activity.title}`} disabled={disabled || index === 0} onClick={onMoveUp} variant="quiet"><ArrowUp aria-hidden="true" size={16} /></Button>
        <Button aria-label={`${t('Move Down')} ${activity.title}`} disabled={disabled || index === total - 1} onClick={onMoveDown} variant="quiet"><ArrowDown aria-hidden="true" size={16} /></Button>
        <Button aria-label={`${t('Edit')} ${activity.title}`} disabled={disabled} onClick={onEdit} variant="quiet"><Pencil aria-hidden="true" size={16} /></Button>
        <Button aria-label={`${t('Delete')} ${activity.title}`} disabled={disabled} onClick={onDelete} variant="quiet"><Trash2 aria-hidden="true" size={16} /></Button>
      </div>
    </article>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { adminApi, AdminApiRequestError } from '../services/adminApi';
import type { AcademicArchive, AcademicYear, AcademicYearStatus } from '../../../types/academic';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { LoadingState } from '../../../components/ui/LoadingState';
import { Modal } from '../../../components/ui/Modal';
import { AdminPageContainer } from '../components/AdminPageContainer';
import { useLocale } from '../../../app/i18n/LocaleProvider';
import { useAdminData } from '../data/AdminDataProvider';
import {
  applyYearStatus,
  moveYear,
  normalizeYearOrder,
  sortYearsByOrder,
  validateAcademicYearForm,
  type AcademicYearFormErrors,
  type AcademicYearFormValues,
} from '../years/academicYears';

type EditorState =
  | { kind: 'closed' }
  | { kind: 'create'; values: AcademicYearFormValues }
  | { kind: 'edit'; yearId: string; values: AcademicYearFormValues };

type ConfirmationState = 'reload' | 'discard' | null;
type PageStatus = { kind: 'success' | 'error' | 'conflict' | 'validation'; message: string } | null;

interface AcademicYearsPageProps {
  onRequireLogin: () => void;
  onUnsavedChanges: (hasChanges: boolean) => void;
}

const DEFAULT_EDITOR_VALUES: AcademicYearFormValues = { name: '', status: 'upcoming' };

const STATUS_LABELS: Record<AcademicYearStatus, string> = {
  previous: 'Previous',
  current: 'Current',
  upcoming: 'Upcoming',
};

export function AcademicYearsPage({ onRequireLogin, onUnsavedChanges }: AcademicYearsPageProps) {
  const { t } = useLocale();
  const { data: initialData, sha: initialSha, refresh, replaceArchive } = useAdminData();
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('ready');
  const [remoteData, setRemoteData] = useState<AcademicArchive>(initialData);
  const [localData, setLocalData] = useState<AcademicArchive>(initialData);
  const [remoteSha, setRemoteSha] = useState(initialSha);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [editor, setEditor] = useState<EditorState>({ kind: 'closed' });
  const [editorErrors, setEditorErrors] = useState<AcademicYearFormErrors>({});
  const [deleteYearId, setDeleteYearId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState>(null);
  const [pageStatus, setPageStatus] = useState<PageStatus>(null);

  const isBusy = isSaving || isReloading;
  const orderedYears = localData ? sortYearsByOrder(localData.years) : [];
  const editedYear = editor.kind === 'edit'
    ? orderedYears.find((year) => year.id === editor.yearId)
    : undefined;
  const yearPendingDelete = deleteYearId
    ? orderedYears.find((year) => year.id === deleteYearId)
    : undefined;

  function applyLoadedData(data: AcademicArchive, sha: string) {
    const orderedData = { ...data, years: sortYearsByOrder(data.years) };
    replaceArchive(orderedData, sha);
    setRemoteData(orderedData);
    setLocalData(orderedData);
    setRemoteSha(sha);
    setIsDirty(false);
    setEditor({ kind: 'closed' });
    setEditorErrors({});
    setDeleteYearId(null);
    setConfirmation(null);
    setPageStatus(null);
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

  function setYears(years: AcademicYear[]) {
    setLocalData((current) => current ? { ...current, years } : current);
    setIsDirty(true);
    setPageStatus(null);
  }

  function openCreateEditor() {
    setEditor({ kind: 'create', values: DEFAULT_EDITOR_VALUES });
    setEditorErrors({});
    setPageStatus(null);
  }

  function openEditEditor(year: AcademicYear) {
    setEditor({
      kind: 'edit',
      yearId: year.id,
      values: { name: year.name, status: year.status },
    });
    setEditorErrors({});
    setPageStatus(null);
  }

  function closeEditor() {
    setEditor({ kind: 'closed' });
    setEditorErrors({});
  }

  function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!localData || editor.kind === 'closed' || isBusy) return;

    const editingId = editor.kind === 'edit' ? editor.yearId : undefined;
    const validation = validateAcademicYearForm(editor.values, localData.years, editingId);
    setEditorErrors(validation.errors);
    if (!validation.valid) {
      setPageStatus({ kind: 'validation', message: 'Please correct the highlighted fields.' });
      return;
    }

    const status = validation.values.status;
    const id = editor.kind === 'edit' ? editor.yearId : crypto.randomUUID();
    const withoutTarget = editor.kind === 'edit'
      ? localData.years.filter((year) => year.id !== editor.yearId)
      : localData.years;
    const nextYear: AcademicYear = {
      ...(editor.kind === 'edit' ? editedYear : undefined),
      id,
      name: validation.values.name,
      status,
      order: editor.kind === 'edit' ? editedYear?.order ?? localData.years.length + 1 : localData.years.length + 1,
    };
    const withYear = editor.kind === 'edit'
      ? [...withoutTarget, nextYear].sort((left, right) => left.order - right.order)
      : [...localData.years, nextYear];
    const withCurrentStatus = applyYearStatus(withYear, id, status);
    setYears(normalizeYearOrder(withCurrentStatus));
    closeEditor();
  }

  function requestDelete(yearId: string) {
    setDeleteYearId(yearId);
    setPageStatus(null);
  }

  function confirmDelete() {
    if (!yearPendingDelete || !localData || isBusy) return;
    if (yearPendingDelete.modules && yearPendingDelete.modules.length > 0) {
      setPageStatus({ kind: 'error', message: 'This academic year contains modules and cannot be deleted in this phase.' });
      setDeleteYearId(null);
      return;
    }
    setYears(normalizeYearOrder(orderedYears.filter((year) => year.id !== yearPendingDelete.id)));
    setDeleteYearId(null);
  }

  function move(yearId: string, offset: -1 | 1) {
    const index = orderedYears.findIndex((year) => year.id === yearId);
    if (index < 0 || isBusy) return;
    const nextYears = moveYear(orderedYears, index, offset);
    if (nextYears === orderedYears) return;
    setYears(nextYears);
  }

  async function saveChanges() {
    if (!localData || !isDirty || isBusy) return;
    const years = normalizeYearOrder(sortYearsByOrder(localData.years));
    const nextData = { ...localData, years };
    setLocalData(nextData);
    setIsSaving(true);
    setPageStatus(null);
    try {
      const result = await adminApi.updateData(nextData, remoteSha, 'Update academic years');
      applyLoadedData(result.data, result.contentSha);
      setIsDirty(false);
      setPageStatus({ kind: 'success', message: 'Academic years saved successfully.' });
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
        setPageStatus({ kind: 'validation', message: 'Please correct the highlighted fields.' });
      } else {
        setPageStatus({ kind: 'error', message: 'Unable to save academic years.' });
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function reloadCurrentData() {
    if (isDirty) {
      setConfirmation('reload');
      return;
    }
    await reloadNow();
  }

  async function reloadNow() {
    setConfirmation(null);
    setIsReloading(true);
    setPageStatus(null);
    try {
      const result = await refresh();
      applyLoadedData(result.data, result.sha);
      setLoadState('ready');
    } catch (error) {
      if (error instanceof AdminApiRequestError && error.status === 401) {
        onRequireLogin();
        return;
      }
      setPageStatus({ kind: 'error', message: 'GitHub access is currently unavailable.' });
    } finally {
      setIsReloading(false);
    }
  }

  function discardChanges() {
    if (!remoteData) return;
    setLocalData(remoteData);
    setIsDirty(false);
    setEditor({ kind: 'closed' });
    setDeleteYearId(null);
    setConfirmation(null);
    setEditorErrors({});
    setPageStatus(null);
  }

  function confirmDiscard() {
    if (confirmation === 'reload') void reloadNow();
    else if (confirmation === 'discard') discardChanges();
  }

  const modalOpen = editor.kind !== 'closed';
  const fieldErrors = editorErrors;

  if (loadState === 'loading') {
    return <AdminPageContainer><LoadingState label={t('Loading academic years...')} /></AdminPageContainer>;
  }

  if (loadState === 'error' || !localData || !remoteData) {
    return (
      <AdminPageContainer>
        <div className="years-page-content">
          <YearsPageHeader />
          <div className="years-error-state" role="alert">
            <p>{t('GitHub access is currently unavailable.')}</p>
            <Button disabled={isReloading} onClick={() => { void reloadNow(); }}>{isReloading ? t('Reloading...') : t('Reload Current Data')}</Button>
          </div>
        </div>
      </AdminPageContainer>
    );
  }

  return (
    <AdminPageContainer>
      <div className="years-page-content">
        <YearsPageHeader />

        {orderedYears.length === 0 ? (
          <Card className="years-empty-state">
            <h3>{t('No academic years yet')}</h3>
            <p>{t('Add the first academic year to start organizing the portfolio.')}</p>
            <Button disabled={isBusy} onClick={openCreateEditor} variant="primary">
              <Plus aria-hidden="true" size={17} />
              {t('Add Academic Year')}
            </Button>
          </Card>
        ) : (
          <section aria-label={t('Academic years list')} className="years-list">
            {orderedYears.map((year, index) => (
              <YearRow
                disabled={isBusy}
                index={index}
                key={year.id}
                onDelete={() => requestDelete(year.id)}
                onEdit={() => openEditEditor(year)}
                onMoveDown={() => move(year.id, 1)}
                onMoveUp={() => move(year.id, -1)}
                total={orderedYears.length}
                year={year}
              />
            ))}
          </section>
        )}

        {orderedYears.length > 0 && (
          <div className="years-add-action">
            <Button disabled={isBusy} onClick={openCreateEditor} variant="primary">
              <Plus aria-hidden="true" size={17} />
              {t('Add Academic Year')}
            </Button>
          </div>
        )}

        <div className="years-save-area">
          <span className="years-dirty-state" role="status">{isDirty ? t('Unsaved changes') : ''}</span>
          <div className="years-page-actions">
            <Button disabled={!isDirty || isBusy} onClick={discardChanges}>{t('Discard Changes')}</Button>
            <Button disabled={isBusy} onClick={() => { void reloadCurrentData(); }}>{isReloading ? t('Reloading...') : t('Reload Current Data')}</Button>
            <Button disabled={!isDirty || isBusy} onClick={() => { void saveChanges(); }} variant="primary">
              {isSaving ? t('Saving...') : t('Save Changes')}
            </Button>
          </div>
        </div>

        <div aria-live="polite" className={`years-save-status${pageStatus ? ` is-${pageStatus.kind}` : ''}`}>
          {pageStatus && (
            <p role={pageStatus.kind === 'success' ? 'status' : 'alert'}>{t(pageStatus.message)}</p>
          )}
        </div>
      </div>

      <Modal
        open={modalOpen}
        title={t(editor.kind === 'edit' ? 'Edit Academic Year' : 'Add Academic Year')}
        onClose={closeEditor}
        className="year-editor-modal"
      >
        {editor.kind !== 'closed' && (
          <form className="year-editor-form" noValidate onSubmit={submitEditor}>
            <div className="year-form-field">
              <label htmlFor="academic-year-name">{t('Academic Year Name')}</label>
              <input
                aria-describedby={fieldErrors.name ? 'academic-year-name-error' : undefined}
                aria-invalid={fieldErrors.name ? 'true' : undefined}
                autoComplete="off"
                disabled={isBusy}
                id="academic-year-name"
                maxLength={41}
                onChange={(event) => {
                  const name = event.target.value;
                  setEditor((current) => current.kind === 'closed' ? current : { ...current, values: { ...current.values, name } });
                  setEditorErrors((current) => ({ ...current, name: undefined }));
                }}
                placeholder={t('e.g. 2026/2027')}
                required
                type="text"
                value={editor.values.name}
              />
              {fieldErrors.name && <p className="year-field-error" id="academic-year-name-error">{fieldErrors.name}</p>}
            </div>
            <div className="year-form-field">
              <label htmlFor="academic-year-status">{t('Status')}</label>
              <select
                aria-describedby={fieldErrors.status ? 'academic-year-status-error' : undefined}
                aria-invalid={fieldErrors.status ? 'true' : undefined}
                disabled={isBusy}
                id="academic-year-status"
                onChange={(event) => {
                  const status = event.target.value;
                  setEditor((current) => current.kind === 'closed' ? current : { ...current, values: { ...current.values, status } });
                  setEditorErrors((current) => ({ ...current, status: undefined }));
                }}
                required
                value={editor.values.status}
              >
                <option value="previous">{t('Previous')}</option>
                <option value="current">{t('Current')}</option>
                <option value="upcoming">{t('Upcoming')}</option>
              </select>
              {fieldErrors.status && <p className="year-field-error" id="academic-year-status-error">{fieldErrors.status}</p>}
            </div>
            <div className="year-editor-actions">
              <Button disabled={isBusy} onClick={closeEditor}>{t('Cancel')}</Button>
              <Button disabled={isBusy} type="submit" variant="primary">
                {t(editor.kind === 'edit' ? 'Save Year' : 'Add Academic Year')}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={yearPendingDelete !== undefined}
        title={t('Delete Academic Year?')}
        onClose={() => setDeleteYearId(null)}
        className="year-confirm-modal"
      >
        <p className="year-confirm-message">{t('This action will remove the academic year from the portfolio structure.')}</p>
        <div className="year-editor-actions">
          <Button disabled={isBusy} onClick={() => setDeleteYearId(null)}>{t('Cancel')}</Button>
          <Button disabled={isBusy} onClick={confirmDelete} variant="primary">{t('Delete Academic Year')}</Button>
        </div>
      </Modal>

      <Modal
        open={confirmation !== null}
        title={t(confirmation === 'reload' ? 'Reload Current Data' : 'Discard Changes')}
        onClose={() => setConfirmation(null)}
        className="year-confirm-modal"
      >
        <p className="year-confirm-message">
          {t(confirmation === 'reload' ? 'Reloading will discard your unsaved changes.' : 'You have unsaved changes.')}
        </p>
        <div className="year-editor-actions">
          <Button disabled={isBusy} onClick={() => setConfirmation(null)}>{t('Cancel')}</Button>
          <Button disabled={isBusy} onClick={confirmDiscard} variant="primary">
            {t(confirmation === 'reload' ? 'Reload' : 'Discard Changes')}
          </Button>
        </div>
      </Modal>
    </AdminPageContainer>
  );
}

function YearsPageHeader() {
  const { t } = useLocale();
  return (
    <header className="years-page-header">
      <h2>{t('Academic Years')}</h2>
      <p>{t('Create, edit, organize, and manage the academic years in the portfolio.')}</p>
    </header>
  );
}

interface YearRowProps {
  year: AcademicYear;
  index: number;
  total: number;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function YearRow({ year, index, total, disabled, onEdit, onDelete, onMoveUp, onMoveDown }: YearRowProps) {
  const { t } = useLocale();
  return (
    <Card className="academic-year-row">
      <div className="academic-year-details">
        <h3>{year.name}</h3>
        <span className={`year-status-badge is-${year.status}`}>{t(STATUS_LABELS[year.status])}</span>
        <span className="academic-year-order">{t('Order')} {year.order}</span>
      </div>
      <div className="academic-year-actions">
        <Button disabled={disabled} onClick={onEdit}>
          <Pencil aria-hidden="true" size={15} /> {t('Edit')}
        </Button>
        <Button disabled={disabled} onClick={onDelete}>
          <Trash2 aria-hidden="true" size={15} /> {t('Delete')}
        </Button>
        <Button aria-label={`${t('Move Up')} ${year.name}`} disabled={disabled || index === 0} onClick={onMoveUp}>
          <ChevronUp aria-hidden="true" size={17} /> <span>{t('Move Up')}</span>
        </Button>
        <Button aria-label={`${t('Move Down')} ${year.name}`} disabled={disabled || index === total - 1} onClick={onMoveDown}>
          <ChevronDown aria-hidden="true" size={17} /> <span>{t('Move Down')}</span>
        </Button>
      </div>
    </Card>
  );
}
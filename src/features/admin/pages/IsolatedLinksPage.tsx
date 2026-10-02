import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, ClipboardList, Copy, ExternalLink, RefreshCw, Search, ShieldOff, Trash2, X } from 'lucide-react';
import { adminApi, AdminApiRequestError } from '../services/adminApi';
import type { AcademicArchive, IsolatedLink } from '../../../types/academic';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { LoadingState } from '../../../components/ui/LoadingState';
import { Modal } from '../../../components/ui/Modal';
import { AdminPageContainer } from '../components/AdminPageContainer';
import { isolatedAssessmentUrl } from '../../../app/routing';
import { AnimatedDisclosure } from '../components/AnimatedModuleAccordion';
import { useLocale } from '../../../app/i18n/LocaleProvider';
import { professorUrlsFromTokens, useAdminData } from '../data/AdminDataProvider';

type PageStatus = { kind: 'success' | 'error' | 'conflict' | 'validation'; message: string } | null;

interface IsolatedLinksPageProps {
  onRequireLogin: () => void;
  onUnsavedChanges: (hasChanges: boolean) => void;
}

export function IsolatedLinksPage({ onRequireLogin, onUnsavedChanges }: IsolatedLinksPageProps) {
  const { locale, t } = useLocale();
  const { data: initialData, sha: initialSha, professorUrls: initialUrls, refresh, replaceArchive, mergeProfessorUrls } = useAdminData();
  const initialLoadedData = { ...initialData, isolatedLinks: initialData.isolatedLinks ?? [] };
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('ready');
  const [remoteData, setRemoteData] = useState<AcademicArchive>(initialLoadedData);
  const [localData, setLocalData] = useState<AcademicArchive>(initialLoadedData);
  const [remoteSha, setRemoteSha] = useState(initialSha);
  const [isDirty, setIsDirty] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);
  const [expandedActivitiesModuleId, setExpandedActivitiesModuleId] = useState<string | null>(null);
  const [pendingUrls, setPendingUrls] = useState<Record<string, string>>({});
  const [savedUrls, setSavedUrls] = useState<Record<string, string>>(initialUrls);
  const [fallbackLinkId, setFallbackLinkId] = useState<string | null>(null);
  const [deleteLinkId, setDeleteLinkId] = useState<string | null>(null);
  const [reloadConfirmation, setReloadConfirmation] = useState(false);
  const [pageStatus, setPageStatus] = useState<PageStatus>(null);
  const busyLock = useRef(false);

  const years = localData?.years ?? [];
  const modules = localData?.modules ?? [];
  const activities = localData?.activities ?? [];
  const links = localData?.isolatedLinks ?? [];
  const yearMap = new Map(years.map((year) => [year.id, year]));
  const orderedModules = [...modules].sort((left, right) => (
    ((yearMap.get(left.yearId)?.order ?? Number.MAX_SAFE_INTEGER) - (yearMap.get(right.yearId)?.order ?? Number.MAX_SAFE_INTEGER))
      || left.yearId.localeCompare(right.yearId)
      || left.order - right.order
  ));
  const linkPendingDelete = deleteLinkId ? links.find((link) => link.id === deleteLinkId) : undefined;
  const query = searchTerm.trim().toLocaleLowerCase(locale);
  const visibleModules = orderedModules.flatMap((module) => {
    const moduleActivities = activities.filter((activity) => activity.moduleId === module.id).sort((left, right) => left.order - right.order);
    const moduleText = `${module.name} ${module.code} ${yearMap.get(module.yearId)?.name ?? ''}`.toLocaleLowerCase(locale);
    const matchesModule = !query || moduleText.includes(query);
    const matchingActivities = moduleActivities.filter((activity) => activity.title.toLocaleLowerCase(locale).includes(query));
    if (!matchesModule && matchingActivities.length === 0) return [];
    return [{ module, activities: matchesModule ? moduleActivities : matchingActivities }];
  });
  function applyData(data: AcademicArchive, sha: string, urls?: Record<string, string>) {
    const nextData = { ...data, isolatedLinks: data.isolatedLinks ?? [] };
    replaceArchive(nextData, sha);
    setRemoteData(nextData);
    setLocalData(nextData);
    setRemoteSha(sha);
    setIsDirty(false);
    setDeleteLinkId(null);
    setReloadConfirmation(false);
    setPendingUrls({});
    if (urls) setSavedUrls(urls);
    setPageStatus(null);
    setExpandedModuleId(null);
    setExpandedActivitiesModuleId(null);
  }

  useEffect(() => () => onUnsavedChanges(false), [onUnsavedChanges]);

  useEffect(() => { onUnsavedChanges(isDirty); }, [isDirty, onUnsavedChanges]);
  useEffect(() => {
    if (pageStatus?.kind !== 'success') return undefined;
    const timer = window.setTimeout(() => setPageStatus(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [pageStatus]);

  function beginBusy() {
    if (busyLock.current) return false;
    busyLock.current = true;
    setIsBusy(true);
    return true;
  }

  function endBusy() {
    busyLock.current = false;
    setIsBusy(false);
  }

  async function regenerateLink(link: IsolatedLink) {
    if (!localData || isBusy || isDirty || link.status !== 'active') return;
    if (!beginBusy()) return;
    setPageStatus(null);
    try {
      const result = await adminApi.issueIsolatedLinkToken({ id: link.id });
      const shareUrl = isolatedAssessmentUrl(result.token, window.location.origin);
      setLocalData((current) => current ? {
        ...current,
        isolatedLinks: (current.isolatedLinks ?? []).map((item) => item.id === link.id ? result.link : item),
      } : current);
      setPendingUrls((current) => ({ ...current, [link.id]: shareUrl }));
      setIsDirty(true);
      setPageStatus({ kind: 'success', message: 'Replacement link prepared. Save Changes to revoke the previous token.' });
    } catch (error) {
      handleRequestError(error, onRequireLogin, setPageStatus);
    } finally {
      endBusy();
    }
  }

  function updateLink(linkId: string, update: Partial<IsolatedLink>) {
    if (!localData || isBusy || isDirty) return;
    setLocalData({
      ...localData,
      isolatedLinks: links.map((link) => link.id === linkId ? { ...link, ...update } : link),
    });
    setIsDirty(true);
    setPageStatus(null);
  }

  function confirmDelete() {
    if (!localData || !linkPendingDelete || isBusy || isDirty) return;
    setLocalData({
      ...localData,
      isolatedLinks: links.filter((link) => link.id !== linkPendingDelete.id),
    });
    setDeleteLinkId(null);
    setIsDirty(true);
    setPageStatus(null);
    setPendingUrls((current) => {
      const next = { ...current };
      delete next[linkPendingDelete.id];
      return next;
    });
    setSavedUrls((current) => {
      const next = { ...current };
      delete next[linkPendingDelete.id];
      return next;
    });
  }

  async function saveChanges() {
    if (!localData || !remoteSha || !isDirty || isBusy) return;
    if (!beginBusy()) return;
    setPageStatus(null);
    try {
      const result = await adminApi.updateData(localData, remoteSha, 'Update isolated assessment links');
      applyData(result.data, result.contentSha, professorUrlsFromTokens(result.links));
      mergeProfessorUrls(pendingUrls);
      setPageStatus({ kind: 'success', message: 'Isolated links saved to GitHub.' });
    } catch (error) {
      handleRequestError(error, onRequireLogin, setPageStatus);
    } finally {
      endBusy();
    }
  }

  function discardChanges() {
    if (!remoteData) return;
    setLocalData(remoteData);
    setIsDirty(false);
    setPendingUrls({});
    setDeleteLinkId(null);
    setPageStatus(null);
  }

  function requestReload() {
    if (isDirty) {
      setReloadConfirmation(true);
      return;
    }
    void reloadData();
  }

  async function reloadData() {
    if (!beginBusy()) return;
    setReloadConfirmation(false);
    setPageStatus(null);
    try {
      const result = await refresh();
      applyData(result.data, result.sha, result.professorUrls);
      setLoadState('ready');
    } catch (error) {
      handleRequestError(error, onRequireLogin, setPageStatus);
    } finally {
      endBusy();
    }
  }

  async function copyShareUrl(linkId: string) {
    const url = savedUrls[linkId];
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setFallbackLinkId(null);
      setPageStatus({ kind: 'success', message: 'Share link copied.' });
    } catch {
      setFallbackLinkId(linkId);
      setPageStatus({ kind: 'error', message: 'Clipboard access is unavailable. Select the share link to copy it.' });
    }
  }

  if (loadState === 'loading') return <AdminPageContainer><LoadingState label={t('Loading isolated links...')} /></AdminPageContainer>;
  if (loadState === 'error' || !localData || !remoteData) {
    return <AdminPageContainer><div className="isolated-links-content"><IsolatedLinksHeader /><div className="isolated-links-error" role="alert"><p>{t('GitHub data could not be loaded.')}</p><Button disabled={isBusy} onClick={() => { void reloadData(); }}>{t('Reload Current Data')}</Button></div></div></AdminPageContainer>;
  }

  function renderLinkEntry(link: IsolatedLink, title: string) {
    const shareUrl = savedUrls[link.id];
    const canCopy = Boolean(shareUrl) && !isDirty && link.status === 'active';
    const persistedLink = remoteData?.isolatedLinks?.find((item) => item.id === link.id);
    const hasPendingStatus = persistedLink !== undefined && persistedLink.status !== link.status;
    const isExpired = link.expiresAt !== null && Date.parse(link.expiresAt) <= Date.now();
    const stateKey = pendingUrls[link.id]
      ? 'Pending Save'
      : hasPendingStatus
        ? link.status === 'active' ? 'Pending Activation' : 'Pending Revocation'
        : isExpired ? 'Expired' : link.status === 'active' ? 'Active' : 'Revoked';
    const stateClass = stateKey.startsWith('Pending') ? 'is-pending' : `is-${link.status}`;
    const stateLabel = t(stateKey);

    return (
      <div className="isolated-link-entry" key={link.id}>
        <div className="isolated-link-entry-info">
          <strong>{title}</strong>
          <span className={`isolated-link-status ${stateClass}`}>{stateLabel}</span>
          <span className="isolated-link-kind">{link.purpose === 'primary-professor' ? 'Primary' : 'Legacy'}</span>
          {link.expiresAt && <small>{t('Expires')} {new Date(link.expiresAt).toLocaleDateString(locale)}</small>}
        </div>
        <div className="isolated-link-entry-actions">
          <Button disabled={!canCopy} onClick={() => { void copyShareUrl(link.id); }} variant="quiet"><Copy aria-hidden="true" size={14} />{t('Copy link')}</Button>
          <Button disabled={!shareUrl || isDirty || link.status !== 'active' || isExpired} onClick={() => window.open(shareUrl, '_blank', 'noopener,noreferrer')} variant="quiet"><ExternalLink aria-hidden="true" size={14} />{t('Open')}</Button>
          <Button disabled={isBusy || isDirty} onClick={() => updateLink(link.id, { status: link.status === 'active' ? 'revoked' : 'active' })} variant="quiet">
            {link.status === 'active' ? <><ShieldOff aria-hidden="true" size={14} />{t('Revoke')}</> : <><Check aria-hidden="true" size={14} />{t('Activate')}</>}
          </Button>
          <details className="isolated-link-more">
            <summary>{t('More')}</summary>
            <div>
              <Button disabled={isBusy || isDirty || link.status !== 'active' || isExpired} onClick={() => { void regenerateLink(link); }} variant="quiet"><RefreshCw aria-hidden="true" size={14} />{t('Replace token')}</Button>
              {link.purpose !== 'primary-professor' && <Button disabled={isBusy || isDirty} onClick={() => setDeleteLinkId(link.id)} variant="quiet"><Trash2 aria-hidden="true" size={14} />{t('Delete legacy link')}</Button>}
            </div>
          </details>
        </div>
        {fallbackLinkId === link.id && shareUrl && (
          <input aria-label={t('Share URL for {title}', { title })} className="isolated-link-fallback-url" onFocus={(event) => event.currentTarget.select()} readOnly value={shareUrl} />
        )}
      </div>
    );
  }

  return (
    <AdminPageContainer>
      <div className="isolated-links-content">
        <IsolatedLinksHeader />
        {links.length > 0 && (
          <div className="isolated-links-toolbar">
            <label className="isolated-links-search">
              <Search aria-hidden="true" size={16} />
              <input aria-label={t('Search Modules and Activities')} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t('Search Modules and Activities')} value={searchTerm} />
              {searchTerm && <Button aria-label={t('Clear search')} onClick={() => setSearchTerm('')} variant="quiet"><X aria-hidden="true" size={14} /></Button>}
            </label>
            <span>{visibleModules.length} / {orderedModules.length} {t('Modules')}</span>
          </div>
        )}
        {links.length === 0 ? (
          <Card className="isolated-links-empty">
            <h3>{t('No isolated links')}</h3>
            <p>{t('Professor Links are provisioned automatically when Modules and Activities are saved.')}</p>
          </Card>
        ) : (
          visibleModules.length === 0 ? (
            <p className="isolated-nested-empty" role="status">{t('No Modules or Activities match this search.')}</p>
          ) : (
          <section aria-label={t('Module Professor Links')} className="isolated-module-groups">
            {visibleModules.map(({ module, activities: moduleActivities }) => {
              const year = yearMap.get(module.yearId);
              const moduleLinks = links.filter((link) => link.scopeType === 'module' && link.scopeId === module.id);
              const primaryModuleLinks = moduleLinks.filter((link) => link.purpose === 'primary-professor');
              const legacyModuleLinks = moduleLinks.filter((link) => link.purpose !== 'primary-professor');
              return (
                <AnimatedDisclosure
                  count={moduleActivities.length}
                  countLabel={t(moduleActivities.length === 1 ? 'Activity' : 'Activities')}
                  expanded={expandedModuleId === module.id}
                  icon={<BookOpen aria-hidden="true" size={20} />}
                  id={`links-module-${module.id}`}
                  key={module.id}
                  metadata={`${module.code} · ${year?.name ?? t('Academic year')}`}
                  onToggle={() => {
                    setExpandedModuleId((current) => current === module.id ? null : module.id);
                    setExpandedActivitiesModuleId(null);
                  }}
                  title={module.name}
                >
                  <div className="isolated-module-primary-links">
                    {primaryModuleLinks.length > 0
                      ? primaryModuleLinks.map((link) => renderLinkEntry(link, t('Module Link')))
                      : <p className="isolated-nested-empty">{t('Module link will be provisioned when the Module is saved.')}</p>}
                  </div>
                  {legacyModuleLinks.length > 0 && (
                    <details className="isolated-legacy-links">
                      <summary>{t('Legacy Module Links')} <span>{legacyModuleLinks.length}</span></summary>
                      {legacyModuleLinks.map((link) => renderLinkEntry(link, t('Legacy Module Link')))}
                    </details>
                  )}
                  <AnimatedDisclosure
                    count={moduleActivities.length}
                    countLabel={t('Activities')}
                    expanded={expandedActivitiesModuleId === module.id}
                    icon={<ClipboardList aria-hidden="true" size={18} />}
                    id={`links-activities-${module.id}`}
                    metadata={t('Activity-specific Professor Links')}
                    onToggle={() => setExpandedActivitiesModuleId((current) => current === module.id ? null : module.id)}
                    title={t('Activities')}
                  >
                    {moduleActivities.length === 0 ? <p className="isolated-nested-empty">{t('No Activities in this Module.')}</p> : (
                      <ol className="isolated-activity-list">
                        {moduleActivities.map((activity, index) => {
                          const activityLinks = links.filter((link) => link.scopeType === 'activity' && link.scopeId === activity.id);
                          const primaryActivityLinks = activityLinks.filter((link) => link.purpose === 'primary-professor');
                          const legacyActivityLinks = activityLinks.filter((link) => link.purpose !== 'primary-professor');
                          return (
                            <li className="isolated-activity-group" key={activity.id}>
                              <div className="isolated-activity-heading">
                                <span>{String(index + 1).padStart(2, '0')}</span>
                                <strong>{activity.title}</strong>
                                <small>{t(activity.type.charAt(0).toUpperCase() + activity.type.slice(1))}</small>
                              </div>
                              <div className="isolated-activity-links">
                                {primaryActivityLinks.length > 0
                                  ? primaryActivityLinks.map((link) => renderLinkEntry(link, t('Activity Link')))
                                  : <p className="isolated-nested-empty">{t('Activity link will be provisioned when the Activity is saved.')}</p>}
                                {legacyActivityLinks.length > 0 && (
                                  <details className="isolated-legacy-links">
                                    <summary>{t('Legacy Activity Links')} <span>{legacyActivityLinks.length}</span></summary>
                                    {legacyActivityLinks.map((link) => renderLinkEntry(link, t('Legacy Activity Link')))}
                                  </details>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </AnimatedDisclosure>
                </AnimatedDisclosure>
              );
            })}
          </section>
          )
        )}

        <div className="isolated-links-save-area">
          <span className="isolated-links-dirty" role="status">{isDirty ? t('Unsaved changes') : ''}</span>
          <div className="isolated-links-actions">
            <Button disabled={!isDirty || isBusy} onClick={discardChanges}>{t('Discard Changes')}</Button>
            <Button disabled={isBusy} onClick={requestReload}>{isBusy ? t('Working...') : t('Reload Current Data')}</Button>
            <Button disabled={!isDirty || isBusy} onClick={() => { void saveChanges(); }} variant="primary">{isBusy ? t('Saving...') : t('Save Changes')}</Button>
          </div>
        </div>
        <div aria-live="polite" className={`isolated-links-status${pageStatus ? ` is-${pageStatus.kind}` : ''}`}>
          {pageStatus && <p role={pageStatus.kind === 'success' ? 'status' : 'alert'}>{t(pageStatus.message)}</p>}
        </div>
      </div>

      <Modal open={linkPendingDelete !== undefined} title={t('Delete Isolated Link?')} onClose={() => setDeleteLinkId(null)} className="admin-confirm-dialog">
        <p className="admin-confirm-message">{t('Deleting this link removes its token digest from the archive. The shared URL will stop working after Save.')}</p>
        <div className="admin-confirm-actions"><Button disabled={isBusy} onClick={() => setDeleteLinkId(null)}>{t('Cancel')}</Button><Button disabled={isBusy} onClick={confirmDelete} variant="primary">{t('Delete Link')}</Button></div>
      </Modal>

      <Modal open={reloadConfirmation} title={t('Reload Current Data')} onClose={() => setReloadConfirmation(false)} className="admin-confirm-dialog">
        <p className="admin-confirm-message">{t('Reloading will discard your unsaved isolated-link changes.')}</p>
        <div className="admin-confirm-actions"><Button onClick={() => setReloadConfirmation(false)}>{t('Cancel')}</Button><Button onClick={() => { void reloadData(); }} variant="primary">{t('Reload')}</Button></div>
      </Modal>
    </AdminPageContainer>
  );
}

function handleRequestError(error: unknown, onRequireLogin: () => void, setStatus: (status: PageStatus) => void) {
  if (error instanceof AdminApiRequestError && error.status === 401) {
    onRequireLogin();
    return;
  }
  setStatus({
    kind: error instanceof AdminApiRequestError && error.status === 409 ? 'conflict' : 'error',
    message: error instanceof Error ? error.message : 'The isolated-link request failed.',
  });
}

function IsolatedLinksHeader() {
  const { t } = useLocale();
  return <header className="isolated-links-header"><h2>{t('Isolated Links')}</h2><p>{t('Manage the Professor Links attached to Modules and Activities.')}</p></header>;
}

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { BookOpen, Check, ClipboardCheck, Code2, Copy, FileArchive, FileSpreadsheet, FileText, Files, ShieldCheck, UserRound, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { ISOLATED_ASSESSMENT_ROUTE_PREFIX, isolatedAssetPath, isolatedProfilePhotoPath } from '../app/routing';
import { ThemeToggle } from '../app/theme/ThemeToggle';
import { LocaleSwitcher } from '../app/i18n/LocaleSwitcher';
import { useLocale } from '../app/i18n/LocaleProvider';
import { AppShell } from '../components/layout/AppShell';
import { PageContainer } from '../components/layout/PageContainer';
import { Button } from '../components/ui/Button';
import type { AcademicArchive, Activity, Asset, Module, ProfessorFeedback } from '../types/academic';

type IsolatedAssetMetadata = Pick<Asset, 'id' | 'activityId' | 'name' | 'type' | 'order' | 'visibility'>;

interface IsolatedScopeData {
  scopeType: 'module' | 'activity';
  scopeId: string;
  site: AcademicArchive['site'];
  profile?: Pick<NonNullable<AcademicArchive['profile']>, 'lastName' | 'firstName' | 'filiere' | 'section' | 'tdGroup'> & { photoAvailable?: boolean };
  year: Pick<AcademicArchive['years'][number], 'id' | 'name' | 'status' | 'order'>;
  module: Module;
  activities: Activity[];
  assets: IsolatedAssetMetadata[];
  feedbackByActivity: Record<string, ProfessorFeedbackView | null>;
}

const TYPE_ICONS = { PDF: FileText, DOCX: FileText, XLSX: FileSpreadsheet, ZIP: FileArchive, CODE: Code2 } as const;
type ProfessorFeedbackView = Pick<ProfessorFeedback, 'professorName' | 'score' | 'comments' | 'observations' | 'submittedAt'>;

export function IsolatedAccess() {
  const { t } = useLocale();
  const location = useLocation();
  const token = location.pathname.startsWith(`${ISOLATED_ASSESSMENT_ROUTE_PREFIX}/`)
    ? location.pathname.slice(ISOLATED_ASSESSMENT_ROUTE_PREFIX.length + 1)
    : '';
  const [state, setState] = useState<{ kind: 'loading'; token: string } | { kind: 'ready'; token: string; scope: IsolatedScopeData } | { kind: 'error'; token: string }>({ kind: 'loading', token: '' });
  const manifestRequest = useRef<{ token: string; promise: Promise<IsolatedScopeData> } | null>(null);
  const visibleState = state.token === token ? state : { kind: 'loading' as const, token };

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading', token });

    let request = manifestRequest.current;
    if (!request || request.token !== token) {
      const promise = fetch(`/api/isolated/resolve?token=${encodeURIComponent(token)}`, {
          cache: 'no-store',
          credentials: 'omit',
          headers: { Accept: 'application/json' },
        }).then(async (response) => {
          if (!response.ok) throw new Error('Unavailable');
          const payload = await response.json() as { success?: boolean; scope?: IsolatedScopeData };
          if (payload.success !== true || !payload.scope) throw new Error('Unavailable');
          return payload.scope;
        });
      request = { token, promise };
      manifestRequest.current = request;
    }

    request.promise.then((scope) => {
      if (active) setState({ kind: 'ready', token, scope });
    }).catch(() => {
      if (active) setState({ kind: 'error', token });
    });
    return () => { active = false; };
  }, [token]);

  return (
    <AppShell className="isolated-access-page">
      <header className="isolated-access-header">
        <div className="isolated-access-identity"><BookOpen aria-hidden="true" size={19} /><span><strong>{t('Academic Assessment')}</strong><small>{t('Professor View')} · {visibleState.kind === 'ready' ? visibleState.scope.site.title ?? t('Isolated Link') : t('Isolated Link')}</small></span></div>
        <span className="professor-readonly"><ShieldCheck aria-hidden="true" size={15} />{t('Read-only view')}</span>
        <LocaleSwitcher />
        <ThemeToggle />
      </header>
      <main>
        <PageContainer>
          {visibleState.kind === 'loading' ? <IsolatedLoadingSkeleton />
            : visibleState.kind === 'error' ? <section className="isolated-access-error" role="alert"><h1>{t('Link unavailable')}</h1><p>{t('This isolated link is invalid, expired, revoked, or no longer points to available content.')}</p></section>
              : <ScopedContent key={token} scope={visibleState.scope} token={token} />}
        </PageContainer>
      </main>
    </AppShell>
  );
}

function ScopedContent({ scope, token }: { scope: IsolatedScopeData; token: string }) {
  const { t } = useLocale();
  const [selectedActivityId, setSelectedActivityId] = useState(scope.activities[0]?.id ?? '');
  const [activePanel, setActivePanel] = useState<'files' | 'code' | 'assessment'>('files');
  const [feedbackByActivity, setFeedbackByActivity] = useState(scope.feedbackByActivity);
  const [codeSources, setCodeSources] = useState<Record<string, CodeSourceState>>({});
  const codeSourceRequests = useRef(new Map<string, Promise<void>>());
  const activeActivity = scope.activities.find((activity) => activity.id === selectedActivityId) ?? scope.activities[0];
  const activeAssets = activeActivity ? scope.assets.filter((asset) => asset.activityId === activeActivity.id) : [];
  const activeCodeAssets = activeAssets.filter((asset) => asset.type === 'CODE');
  const feedback = activeActivity ? feedbackByActivity[activeActivity.id] ?? null : null;
  const academicName = [scope.profile?.firstName, scope.profile?.lastName].filter(Boolean).join(' ') || t('Academic Profile');

  function loadCodeSource(asset: IsolatedAssetMetadata) {
    if (codeSources[asset.id] || codeSourceRequests.current.has(asset.id)) return;
    setCodeSources((current) => current[asset.id] ? current : { ...current, [asset.id]: { kind: 'loading' } });
    const request = fetch(isolatedAssetPath(token, asset.id), {
      cache: 'no-store',
      credentials: 'omit',
      headers: { Accept: 'text/plain' },
    }).then(async (response) => {
      if (!response.ok) throw new Error('Unavailable');
      const source = await response.text();
      setCodeSources((current) => ({ ...current, [asset.id]: { kind: 'ready', source } }));
    }).catch(() => {
      setCodeSources((current) => ({ ...current, [asset.id]: { kind: 'error' } }));
    }).finally(() => {
      codeSourceRequests.current.delete(asset.id);
    });
    codeSourceRequests.current.set(asset.id, request);
  }

  const activitiesLabel = t(scope.scopeType === 'module' ? 'Activities' : 'Activity');
  return (
    <div className="professor-view">
      <div className="professor-dashboard">
        <section aria-label={t('Student information')} className="professor-card professor-identity-card">
          <div className="professor-card-heading">
            <ProfilePhoto token={token} available={scope.profile?.photoAvailable === true} name={academicName} />
            <div><h1>{t('Academic information')}</h1></div>
          </div>
          <dl className="professor-identity-list">
            <IdentityField label="Nom" value={scope.profile?.lastName} />
            <IdentityField label="Prénom" value={scope.profile?.firstName} />
            <IdentityField label="Filière" value={scope.profile?.filiere} />
            <IdentityField label="Section" value={scope.profile?.section} />
            <IdentityField label="Groupe TD" value={scope.profile?.tdGroup} />
          </dl>
        </section>

        <section aria-label={t('Assessment context')} className="professor-card professor-context-card">
          <div className="professor-card-heading"><span className="professor-card-icon"><BookOpen aria-hidden="true" size={19} /></span><div><h2>{t('Assessment Context')}</h2><p>{t('Academic year')} · {scope.year.name}</p></div></div>
          <div className="professor-context-module"><span>{t('Module')}</span><strong>{scope.module.name}</strong><small>{scope.module.code}</small></div>
          <div className="professor-context-activities">
            <div className="professor-context-activity-label"><span>{activitiesLabel}</span><span>{scope.scopeType === 'module' ? scope.activities.length : ''}</span></div>
            {scope.activities.length > 1 ? (
              <div aria-label={t('Activities in this module')} className="professor-activity-picker" role="tablist">
                {scope.activities.map((activity) => (
                  <button
                    aria-selected={activeActivity?.id === activity.id}
                    className={activeActivity?.id === activity.id ? 'is-active' : ''}
                    key={activity.id}
                    onClick={() => { setSelectedActivityId(activity.id); setActivePanel('files'); }}
                    role="tab"
                    type="button"
                  >
                    <span>{t(activity.type.charAt(0).toUpperCase() + activity.type.slice(1))}</span>{activity.title}
                  </button>
                ))}
              </div>
            ) : activeActivity ? (
              <div className="professor-context-selected-activity"><span>{t(activeActivity.type.charAt(0).toUpperCase() + activeActivity.type.slice(1))}</span><strong>{activeActivity.title}</strong></div>
            ) : <p className="professor-empty-message">{t('No Activity is available in this scope.')}</p>}
          </div>
        </section>

        <aside className="professor-side-column">
          <section aria-label={t('Professor assessment')} className="professor-card professor-assessment-card">
            <div className="professor-card-heading"><span className="professor-card-icon"><ClipboardCheck aria-hidden="true" size={19} /></span><div><h2>{t('Professor Assessment')}</h2><p>{activeActivity ? t('Evaluate {activity}', { activity: activeActivity.title }) : t('Select an Activity to assess.')}</p></div></div>
            {!activeActivity ? <p className="professor-empty-message">{t('An assessment requires an Activity in the isolated scope.')}</p>
              : <ProfessorAssessmentForm
                  key={`${token}:${activeActivity.id}`}
                  token={token}
                  activityId={activeActivity.id}
                  initialFeedback={feedback}
                  onSaved={(savedFeedback) => setFeedbackByActivity((current) => ({ ...current, [activeActivity.id]: savedFeedback }))}
                />}
          </section>
        </aside>

        <section aria-label={t('Activity workspace')} className="professor-card professor-workspace">
          <nav aria-label={t('Activity content')} className="professor-content-tabs" role="tablist">
            <ContentTab active={activePanel === 'files'} icon={<Files aria-hidden="true" size={15} />} label={t('Files')} onClick={() => setActivePanel('files')} />
            <ContentTab active={activePanel === 'code'} icon={<Code2 aria-hidden="true" size={15} />} label={t('Code')} onClick={() => setActivePanel('code')} />
            <ContentTab active={activePanel === 'assessment'} icon={<ClipboardCheck aria-hidden="true" size={15} />} label={t('Assessment')} onClick={() => setActivePanel('assessment')} />
          </nav>
          <div className="professor-workspace-content" role="tabpanel">
            {!activeActivity ? <p className="professor-empty-message">{t('No Activity is available in this scope.')}</p> : (
              <>
                <header className="professor-workspace-heading">
                  <div><h2>{t(activePanel === 'files' ? 'Files' : activePanel === 'code' ? 'Code' : 'Activity Assessment')}</h2><p>{activeActivity.title}{activeActivity.description ? ` · ${activeActivity.description}` : ''}</p></div>
                  <span className="professor-type-badge">{t(activeActivity.type.charAt(0).toUpperCase() + activeActivity.type.slice(1))}</span>
                </header>
                {activePanel === 'files' ? <AssetList key={activeActivity.id} assets={activeAssets.filter((asset) => asset.type !== 'CODE')} token={token} activityName={activeActivity.title} />
                  : activePanel === 'code' ? <CodeSourcePanel key={activeActivity.id} assets={activeCodeAssets} token={token} codeSources={codeSources} onLoadSource={loadCodeSource} />
                    : feedback ? <AssessmentSummary feedback={feedback} />
                      : <div className="professor-empty-panel"><ClipboardCheck aria-hidden="true" size={20} /><p>{t('No assessment has been submitted for this Activity.')}</p></div>}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function IdentityField({ label, value }: { label: string; value?: string }) {
  const { t } = useLocale();
  return <div><dt>{t(label)}</dt><dd>{value || t('Not provided')}</dd></div>;
}

function IsolatedLoadingSkeleton() {
  const { t } = useLocale();
  return (
    <div className="professor-view">
      <div aria-label={t('Loading isolated academic content')} className="professor-dashboard professor-dashboard--loading" role="status">
        <section aria-hidden="true" className="professor-card professor-loading-card">
          <span className="professor-skeleton professor-skeleton--heading" /><span className="professor-skeleton" /><span className="professor-skeleton professor-skeleton--short" /><span className="professor-skeleton" />
        </section>
        <section aria-hidden="true" className="professor-card professor-loading-card">
          <span className="professor-skeleton professor-skeleton--heading" /><span className="professor-skeleton" /><span className="professor-skeleton professor-skeleton--short" />
        </section>
        <aside aria-hidden="true" className="professor-side-column"><section className="professor-card professor-loading-card"><span className="professor-skeleton professor-skeleton--heading" /><span className="professor-skeleton" /><span className="professor-skeleton" /><span className="professor-skeleton professor-skeleton--short" /></section></aside>
        <section aria-hidden="true" className="professor-card professor-loading-card professor-loading-workspace"><span className="professor-skeleton professor-skeleton--heading" /><span className="professor-skeleton" /><span className="professor-skeleton" /></section>
      </div>
    </div>
  );
}

function ProfilePhoto({ token, available, name }: { token: string; available: boolean; name?: string }) {
  const { t } = useLocale();
  return available
    ? <img alt={name ? t('{name} profile', { name }) : t('Academic profile')} className="professor-profile-photo" referrerPolicy="no-referrer" src={isolatedProfilePhotoPath(token)} />
    : <span aria-label={t('No profile photo')} className="professor-profile-photo professor-profile-photo--empty"><UserRound aria-hidden="true" size={20} /></span>;
}

function isolatedFeedbackUrl(token: string, activityId: string) {
  const query = new URLSearchParams({ token, activityId });
  return `/api/isolated/feedback?${query.toString()}`;
}

function ContentTab({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button aria-selected={active} className={active ? 'is-active' : ''} onClick={onClick} role="tab" type="button">{icon}{label}</button>;
}

function AssessmentSummary({ feedback }: { feedback: ProfessorFeedbackView }) {
  const { t } = useLocale();
  return <div className="professor-assessment-summary"><strong>{feedback.score} / 20</strong><p>{feedback.comments || t('No comments.')}</p><p>{feedback.observations || t('No errors or observations.')}</p></div>;
}

function AssetList({ assets, token, activityName }: { assets: IsolatedAssetMetadata[]; token: string; activityName: string }) {
  const { t } = useLocale();
  const [pdfState, setPdfState] = useState<{ kind: 'idle' } | { kind: 'loading'; asset: IsolatedAssetMetadata } | { kind: 'ready'; asset: IsolatedAssetMetadata; url: string } | { kind: 'error'; asset: IsolatedAssetMetadata }>({ kind: 'idle' });
  const pdfRequest = useRef<AbortController | null>(null);
  const pdfPreviewUrl = useRef<string | null>(null);

  useEffect(() => () => {
    pdfRequest.current?.abort();
    if (pdfPreviewUrl.current) URL.revokeObjectURL(pdfPreviewUrl.current);
  }, []);

  if (assets.length === 0) return <p className="isolated-empty-activities">{t('No files are available in this scope.')}</p>;
  async function openPdf(asset: IsolatedAssetMetadata) {
    pdfRequest.current?.abort();
    if (pdfPreviewUrl.current) URL.revokeObjectURL(pdfPreviewUrl.current);
    pdfPreviewUrl.current = null;
    const controller = new AbortController();
    pdfRequest.current = controller;
    setPdfState({ kind: 'loading', asset });
    try {
      const response = await fetch(isolatedAssetPath(token, asset.id), {
        cache: 'no-store',
        credentials: 'omit',
        headers: { Accept: 'application/pdf' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Unavailable');
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      pdfPreviewUrl.current = url;
      setPdfState({ kind: 'ready', asset, url });
    } catch {
      if (!controller.signal.aborted) setPdfState({ kind: 'error', asset });
    } finally {
      if (pdfRequest.current === controller) pdfRequest.current = null;
    }
  }

  function closePdf() {
    pdfRequest.current?.abort();
    pdfRequest.current = null;
    if (pdfPreviewUrl.current) URL.revokeObjectURL(pdfPreviewUrl.current);
    pdfPreviewUrl.current = null;
    setPdfState({ kind: 'idle' });
  }

  return (
    <>
      <ul className="isolated-assets">{assets.map((asset) => {
        const Icon = TYPE_ICONS[asset.type];
        return <li key={asset.id}><Icon aria-hidden="true" size={17} /><a href={isolatedAssetPath(token, asset.id)} onClick={asset.type === 'PDF' ? (event) => { event.preventDefault(); void openPdf(asset); } : undefined} referrerPolicy="no-referrer">{asset.name}</a><span>{activityName}</span><span>{asset.type}</span></li>;
      })}</ul>
      {pdfState.kind !== 'idle' && (
        <section aria-label={t('PDF preview')} className="professor-pdf-preview">
          <header><strong>{pdfState.asset.name}</strong><button aria-label={t('Close PDF preview')} onClick={closePdf} type="button"><X aria-hidden="true" size={15} /></button></header>
          {pdfState.kind === 'loading' ? <p role="status">{t('Loading PDF...')}</p>
            : pdfState.kind === 'error' ? <p role="alert">{t('This PDF is unavailable.')}</p>
              : <iframe title={pdfState.asset.name} src={pdfState.url} />}
        </section>
      )}
    </>
  );
}

type CodeSourceState = { kind: 'loading' } | { kind: 'ready'; source: string } | { kind: 'error' };

function CodeSourcePanel({
  assets,
  token,
  codeSources,
  onLoadSource,
}: {
  assets: IsolatedAssetMetadata[];
  token: string;
  codeSources: Record<string, CodeSourceState>;
  onLoadSource: (asset: IsolatedAssetMetadata) => void;
}) {
  const { t } = useLocale();
  const [selectedAssetId, setSelectedAssetId] = useState(assets[0]?.id ?? '');
  const [copied, setCopied] = useState(false);
  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId);
  const sourceState = selectedAsset ? codeSources[selectedAsset.id] ?? { kind: 'loading' as const } : { kind: 'ready' as const, source: '' };

  useEffect(() => {
    if (selectedAsset && !codeSources[selectedAsset.id]) onLoadSource(selectedAsset);
  }, [selectedAsset?.id, token, codeSources, onLoadSource]);

  if (assets.length === 0) return <div className="professor-empty-panel"><Code2 aria-hidden="true" size={20} /><p>{t('No source code is attached to this Activity.')}</p></div>;
  async function copySource() {
    if (sourceState.kind !== 'ready') return;
    try {
      await navigator.clipboard.writeText(sourceState.source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
    }
  }

  return (
    <div className="professor-code-viewer">
      <nav aria-label={t('Code files')} className="professor-code-file-list">{assets.map((asset) => (
        <button className={asset.id === selectedAssetId ? 'is-active' : ''} key={asset.id} onClick={() => setSelectedAssetId(asset.id)} type="button">{asset.name}</button>
      ))}</nav>
      <div className="professor-code-editor">
        <div className="professor-code-title"><Code2 aria-hidden="true" size={15} /><span>{selectedAsset?.name}</span><span>{selectedAsset?.name.split('.').pop()?.toUpperCase()}</span><button aria-label={t(copied ? 'Source copied' : 'Copy source code')} disabled={sourceState.kind !== 'ready'} onClick={() => { void copySource(); }} title={t(copied ? 'Copied' : 'Copy source code')} type="button">{copied ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}</button></div>
        <div className="professor-code-content">
          {sourceState.kind === 'loading' ? <p role="status">{t('Loading source...')}</p>
            : sourceState.kind === 'error' ? <p role="alert">{t('Source code is unavailable.')}</p>
              : <pre><code>{sourceState.source}</code></pre>}
        </div>
      </div>
    </div>
  );
}

function ProfessorAssessmentForm({
  token,
  activityId,
  initialFeedback,
  onSaved,
}: {
  token: string;
  activityId: string;
  initialFeedback: ProfessorFeedbackView | null;
  onSaved: (feedback: ProfessorFeedbackView) => void;
}) {
  const { locale, t } = useLocale();
  const [professorName, setProfessorName] = useState(initialFeedback?.professorName ?? '');
  const [score, setScore] = useState(initialFeedback ? String(initialFeedback.score) : '');
  const [comments, setComments] = useState(initialFeedback?.comments ?? '');
  const [observations, setObservations] = useState(initialFeedback?.observations ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  async function submitAssessment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setStatus(null);
    try {
      const response = await fetch(isolatedFeedbackUrl(token, activityId), {
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ professorName, score: Number(score), comments, observations }),
      });
      const payload = await response.json() as { success?: boolean; feedback?: ProfessorFeedbackView; message?: string };
      if (!response.ok || payload.success !== true || !payload.feedback) {
        throw new Error(payload.message ?? t('Feedback could not be saved.'));
      }
      onSaved(payload.feedback);
      setStatus({ kind: 'success', message: t('Assessment saved.') });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : t('Feedback could not be saved.') });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="professor-feedback-form" onSubmit={(event) => { void submitAssessment(event); }}>
      {initialFeedback && <p className="professor-feedback-saved" role="status">{t('Last submitted')} {new Date(initialFeedback.submittedAt).toLocaleString(locale)}</p>}
      <label>{t('Professor name')}<input autoComplete="name" maxLength={120} required value={professorName} onChange={(event) => setProfessorName(event.target.value)} /></label>
      <label>{t('Score / 20')}<input inputMode="decimal" max="20" min="0" required step="0.25" type="number" value={score} onChange={(event) => setScore(event.target.value)} /></label>
      <label>{t('Comments')}<textarea maxLength={5_000} rows={4} value={comments} onChange={(event) => setComments(event.target.value)} /></label>
      <label>{t('Errors / observations')}<textarea maxLength={5_000} rows={4} value={observations} onChange={(event) => setObservations(event.target.value)} /></label>
      <div className="professor-feedback-actions"><Button disabled={isSubmitting} type="submit" variant="primary">{isSubmitting ? t('Saving assessment...') : initialFeedback ? t('Update assessment') : t('Submit assessment')}</Button></div>
      {status && <p className={status.kind === 'error' ? 'professor-feedback-error' : 'professor-feedback-saved'} role={status.kind === 'error' ? 'alert' : 'status'}>{t(status.message)}</p>}
    </form>
  );
}

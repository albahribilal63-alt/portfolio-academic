import { createContext, useCallback, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { isolatedAssessmentUrl } from '../../../app/routing';
import { Button } from '../../../components/ui/Button';
import { ErrorState } from '../../../components/ui/ErrorState';
import { LoadingState } from '../../../components/ui/LoadingState';
import { AdminPageContainer } from '../components/AdminPageContainer';
import { AdminApiRequestError, adminApi } from '../services/adminApi';
import { useLocale } from '../../../app/i18n/LocaleProvider';
import type { AcademicArchive } from '../../../types/academic';
import { AdminDataStore, type AdminDataPayload } from './AdminDataStore';

export const adminDataStore = new AdminDataStore();

export function professorUrlsFromTokens(links: Array<{ id: string; token: string }>) {
  return Object.fromEntries(links.map(({ id, token }) => [id, isolatedAssessmentUrl(token, window.location.origin)]));
}

interface AdminDataContextValue {
  data: AcademicArchive;
  sha: string;
  professorUrls: Record<string, string>;
  refresh: () => Promise<AdminDataPayload>;
  replaceArchive: (data: AcademicArchive, sha: string, urls?: Record<string, string>) => void;
  mergeProfessorUrls: (urls: Record<string, string>) => void;
}

const AdminDataContext = createContext<AdminDataContextValue | null>(null);

async function loadAdminData() {
  const result = await adminApi.provisionPrimaryProfessorLinks();
  return { data: result.data, sha: result.sha, professorUrls: professorUrlsFromTokens(result.links) };
}

export function clearAdminDataSession() {
  adminDataStore.clear();
}

export function AdminDataProvider({ children, onRequireLogin }: { children: ReactNode; onRequireLogin: () => void }) {
  const { t } = useLocale();
  const snapshot = useSyncExternalStore(adminDataStore.subscribe, adminDataStore.getSnapshot, adminDataStore.getSnapshot);

  useEffect(() => {
    let active = true;
    adminDataStore.initialize(loadAdminData).catch((error: unknown) => {
      if (active && error instanceof AdminApiRequestError && error.status === 401) onRequireLogin();
    });
    return () => { active = false; };
  }, [onRequireLogin]);

  const refresh = useCallback(async () => {
    const result = await adminDataStore.refresh(loadAdminData);
    if (!result.data || !result.sha) throw new Error('Admin data refresh returned an empty snapshot.');
    return { data: result.data, sha: result.sha, professorUrls: result.professorUrls };
  }, []);
  const replaceArchive = useCallback((data: AcademicArchive, sha: string, urls?: Record<string, string>) => {
    adminDataStore.replace(data, sha, urls);
  }, []);
  const mergeProfessorUrls = useCallback((urls: Record<string, string>) => {
    adminDataStore.setProfessorUrls(urls);
  }, []);

  if (snapshot.status === 'idle' || snapshot.status === 'loading') {
    return <AdminPageContainer><LoadingState label={t('Loading admin data...')} /></AdminPageContainer>;
  }

  if (snapshot.status === 'error' || !snapshot.data || !snapshot.sha) {
    return (
      <AdminPageContainer>
        <ErrorState
          title={t('Admin data unavailable')}
          description={snapshot.error instanceof Error ? t(snapshot.error.message) : t('GitHub data could not be loaded.')}
        />
        <Button onClick={() => { void adminDataStore.initialize(loadAdminData).catch((error: unknown) => {
          if (error instanceof AdminApiRequestError && error.status === 401) onRequireLogin();
        }); }}>{t('Retry')}</Button>
      </AdminPageContainer>
    );
  }

  return (
    <AdminDataContext.Provider value={{
      data: snapshot.data,
      sha: snapshot.sha,
      professorUrls: snapshot.professorUrls,
      refresh,
      replaceArchive,
      mergeProfessorUrls,
    }}>
      {children}
    </AdminDataContext.Provider>
  );
}

export function useAdminData() {
  const context = useContext(AdminDataContext);
  if (!context) throw new Error('useAdminData must be used within AdminDataProvider.');
  return context;
}
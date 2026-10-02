import { useCallback, useEffect, useState } from 'react';
import { adminApi, AdminApiRequestError } from '../services/adminApi';
import type { GithubConnectionState } from '../types/state';
import { AdminDashboard } from '../pages/AdminDashboard';
import { AcademicProfilePage } from '../pages/AcademicProfilePage';
import { AcademicYearsPage } from '../pages/AcademicYearsPage';
import { ModulesPage } from '../pages/ModulesPage';
import { ActivitiesPage } from '../pages/ActivitiesPage';
import { AssetsPage } from '../pages/AssetsPage';
import { IsolatedLinksPage } from '../pages/IsolatedLinksPage';
import { AdminShell } from './AdminShell';
import { AdminDataProvider } from '../data/AdminDataProvider';

interface AuthenticatedAdminProps {
  currentPage: 'dashboard' | 'profile' | 'years' | 'modules' | 'activities' | 'assets' | 'isolated-links';
  developmentBypass: boolean;
  onRequireLogin: () => void;
  onSignOut: () => Promise<void>;
}

export function AuthenticatedAdmin({ currentPage, developmentBypass, onRequireLogin, onSignOut }: AuthenticatedAdminProps) {
  const [connection, setConnection] = useState<GithubConnectionState>({ status: 'loading' });
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const setDiscarded = useCallback(() => setHasUnsavedChanges(false), []);

  useEffect(() => {
    let active = true;
    adminApi.getGithubStatus().then((details) => {
      if (active) setConnection({ status: 'connected', details });
    }).catch((error: unknown) => {
      if (!active) return;
      if (error instanceof AdminApiRequestError && error.status === 401) {
        onRequireLogin();
        return;
      }
      setConnection({
        status: 'error',
        message: error instanceof Error ? error.message : 'GitHub is unavailable.',
      });
    });

    return () => { active = false; };
  }, [onRequireLogin]);

  async function signOut() {
    setHasUnsavedChanges(false);
    await onSignOut();
  }

  return (
    <AdminDataProvider onRequireLogin={onRequireLogin}>
      <AdminShell
        connection={connection}
        developmentBypass={developmentBypass}
        hasUnsavedChanges={hasUnsavedChanges}
        onDiscardChanges={setDiscarded}
        onSignOut={signOut}
        pageTitle={currentPage === 'profile'
          ? 'Academic Profile'
          : currentPage === 'years'
            ? 'Academic Years'
            : currentPage === 'modules'
              ? 'Modules'
              : currentPage === 'activities'
                ? 'Activities'
                : currentPage === 'assets'
                  ? 'Files & Assets'
                  : currentPage === 'isolated-links'
                    ? 'Isolated Links'
                    : 'Dashboard'}
      >
        {currentPage === 'profile' ? (
          <AcademicProfilePage onRequireLogin={onRequireLogin} onUnsavedChanges={setHasUnsavedChanges} />
        ) : currentPage === 'years' ? (
          <AcademicYearsPage onRequireLogin={onRequireLogin} onUnsavedChanges={setHasUnsavedChanges} />
        ) : currentPage === 'modules' ? (
          <ModulesPage onRequireLogin={onRequireLogin} onUnsavedChanges={setHasUnsavedChanges} />
        ) : currentPage === 'activities' ? (
          <ActivitiesPage onRequireLogin={onRequireLogin} onUnsavedChanges={setHasUnsavedChanges} />
        ) : currentPage === 'assets' ? (
          <AssetsPage onRequireLogin={onRequireLogin} onUnsavedChanges={setHasUnsavedChanges} />
        ) : currentPage === 'isolated-links' ? (
          <IsolatedLinksPage onRequireLogin={onRequireLogin} onUnsavedChanges={setHasUnsavedChanges} />
        ) : (
          <AdminDashboard connection={connection} />
        )}
      </AdminShell>
    </AdminDataProvider>
  );
}
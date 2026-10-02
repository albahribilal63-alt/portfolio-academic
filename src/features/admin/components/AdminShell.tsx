import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from '../../../components/layout/AppShell';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { AdminHeader } from './AdminHeader';
import { AdminSidebar } from './AdminSidebar';
import { useLocale } from '../../../app/i18n/LocaleProvider';
import type { GithubConnectionState } from '../types/state';
import './admin.css';

interface AdminShellProps {
  connection: GithubConnectionState;
  developmentBypass: boolean;
  pageTitle: 'Dashboard' | 'Academic Profile' | 'Academic Years' | 'Modules' | 'Activities' | 'Files & Assets' | 'Isolated Links';
  children: ReactNode;
  hasUnsavedChanges: boolean;
  onDiscardChanges: () => void;
  onSignOut: () => Promise<void>;
}

export function AdminShell({
  connection,
  developmentBypass,
  pageTitle,
  children,
  hasUnsavedChanges,
  onDiscardChanges,
  onSignOut,
}: AdminShellProps) {
  const { t } = useLocale();
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);
  const [pendingExit, setPendingExit] = useState<{ kind: 'navigate'; to: string } | { kind: 'signout' } | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const closeNavigation = useCallback(() => setIsNavigationOpen(false), []);
  const canNavigate = useCallback((to: string) => {
    if (!hasUnsavedChanges || to === location.pathname) return true;
    setPendingExit({ kind: 'navigate', to });
    return false;
  }, [hasUnsavedChanges, location.pathname]);

  async function handleSignOut() {
    if (hasUnsavedChanges) setPendingExit({ kind: 'signout' });
    else await onSignOut();
  }

  function discardAndExit() {
    const action = pendingExit;
    setPendingExit(null);
    onDiscardChanges();
    closeNavigation();
    if (action?.kind === 'navigate') navigate(action.to);
    if (action?.kind === 'signout') void onSignOut();
  }

  useEffect(() => {
    const desktopQuery = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) closeNavigation();
    };
    desktopQuery.addEventListener('change', closeOnDesktop);
    return () => desktopQuery.removeEventListener('change', closeOnDesktop);
  }, [closeNavigation]);

  useEffect(() => {
    if (!isNavigationOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isNavigationOpen]);

  return (
    <AppShell className="admin-layout">
      <AdminSidebar
        canNavigate={canNavigate}
        isOpen={isNavigationOpen}
        onClose={closeNavigation}
        returnFocusRef={menuButtonRef}
      />
      {isNavigationOpen && (
        <div
          aria-hidden="true"
          className="admin-backdrop"
          onClick={closeNavigation}
        />
      )}
      <div aria-hidden={isNavigationOpen || undefined} className="admin-main-region">
        <AdminHeader
          connection={connection}
          developmentBypass={developmentBypass}
          pageTitle={pageTitle}
          menuButtonRef={menuButtonRef}
          onMenuOpen={() => setIsNavigationOpen(true)}
          onSignOut={handleSignOut}
        />
        <main className="admin-main">
          {children}
        </main>
      </div>
      <Modal
        open={pendingExit !== null}
        title={t('Unsaved changes')}
        onClose={() => setPendingExit(null)}
        className="admin-confirm-dialog"
      >
        <p className="admin-confirm-message">{t('You have unsaved changes.')}</p>
        <div className="admin-confirm-actions">
          <Button onClick={() => setPendingExit(null)}>{t('Stay')}</Button>
          <Button onClick={discardAndExit} variant="primary">{t('Discard Changes')}</Button>
        </div>
      </Modal>
    </AppShell>
  );
}
import { useCallback, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { ADMIN_ACTIVITIES_ROUTE, ADMIN_ASSETS_ROUTE, ADMIN_ISOLATED_LINKS_ROUTE, ADMIN_LOGIN_ROUTE, ADMIN_MODULES_ROUTE, ADMIN_PROFILE_ROUTE, ADMIN_ROUTE, ADMIN_YEARS_ROUTE, normalizeAdminPathname } from '../../app/routing';
import { AppShell } from '../../components/layout/AppShell';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/ErrorState';
import { LoadingState } from '../../components/ui/LoadingState';
import { AdminApiRequestError, adminApi } from './services/adminApi';
import type { AdminAuthState } from './types/state';
import { AdminLoginScreen } from './pages/AdminLoginScreen';
import { AuthenticatedAdmin } from './components/AuthenticatedAdmin';
import { useLocale } from '../../app/i18n/LocaleProvider';
import { clearAdminDataSession } from './data/AdminDataProvider';

export function AdminAuthGate() {
  const { t } = useLocale();
  const location = useLocation();
  const adminPathname = normalizeAdminPathname(location.pathname);
  const isLoginRoute = adminPathname === ADMIN_LOGIN_ROUTE;
  const currentPage = adminPathname === ADMIN_PROFILE_ROUTE
    ? 'profile'
    : adminPathname === ADMIN_YEARS_ROUTE
      ? 'years'
      : adminPathname === ADMIN_MODULES_ROUTE
        ? 'modules'
        : adminPathname === ADMIN_ACTIVITIES_ROUTE
          ? 'activities'
          : adminPathname === ADMIN_ASSETS_ROUTE
            ? 'assets'
            : adminPathname === ADMIN_ISOLATED_LINKS_ROUTE
              ? 'isolated-links'
          : 'dashboard';
  const [authState, setAuthState] = useState<AdminAuthState>({ status: 'checking' });
  const [sessionCheck, setSessionCheck] = useState(0);

  useEffect(() => {
    let active = true;
    setAuthState({ status: 'checking' });
    adminApi.getSession().then((session) => {
      if (!active) return;
      if (session.mode === 'local-development' && session.developmentBypass) {
        setAuthState({ status: 'local-development', developmentBypass: true });
      } else if (session.mode === 'authenticated-session' && !session.developmentBypass && session.adminEmail) {
        setAuthState({ status: 'authenticated', adminEmail: session.adminEmail, developmentBypass: false });
      } else {
        setAuthState({ status: 'session-error', message: 'The Admin API returned an invalid session.' });
      }
    }).catch((error: unknown) => {
      if (!active) return;
      if (error instanceof AdminApiRequestError && error.status === 401) {
        setAuthState({ status: 'unauthenticated' });
      } else {
        setAuthState({
          status: 'session-error',
          message: error instanceof Error ? error.message : 'The Admin API is unavailable.',
        });
      }
    });

    return () => { active = false; };
  }, [sessionCheck]);

  const requireLogin = useCallback(() => {
    clearAdminDataSession();
    setAuthState({ status: 'unauthenticated', message: 'Authenticate again to continue.' });
  }, []);

  async function authenticate(email: string, password: string) {
    setAuthState({ status: 'authenticating' });
    try {
      const result = await adminApi.login(email, password);
      setAuthState({ status: 'authenticated', adminEmail: result.adminEmail, developmentBypass: false });
    } catch (error) {
      setAuthState({
        status: 'unauthenticated',
        message: error instanceof Error ? error.message : 'Authentication failed.',
      });
      throw error;
    }
  }

  async function signOut() {
    clearAdminDataSession();
    try {
      await adminApi.logout();
      setAuthState({ status: 'unauthenticated' });
    } catch (error) {
      setAuthState({
        status: 'unauthenticated',
        message: error instanceof Error ? error.message : 'Sign out could not be confirmed. Check your connection.',
      });
    }
  }

  if (authState.status === 'checking') {
    return <AppShell className="admin-auth-state"><LoadingState label={t('Checking administrator session…')} /></AppShell>;
  }

  if (location.pathname !== adminPathname) {
    return <Navigate replace to={adminPathname} />;
  }

  if (authState.status === 'session-error') {
    return (
      <AppShell className="admin-auth-state">
        <ErrorState title={t('Admin session unavailable')} description={t(authState.message)} />
        <Button onClick={() => setSessionCheck((attempt) => attempt + 1)}>{t('Retry')}</Button>
      </AppShell>
    );
  }

  if (authState.status === 'unauthenticated' && !isLoginRoute) {
    return <Navigate replace state={{ from: adminPathname }} to={ADMIN_LOGIN_ROUTE} />;
  }

  if (authState.status === 'authenticated' || authState.status === 'local-development') {
    if (isLoginRoute) {
      const from = (location.state as { from?: unknown } | null)?.from;
      const destination = typeof from === 'string' && from.startsWith(`${ADMIN_ROUTE}/`) && from !== ADMIN_LOGIN_ROUTE
        ? from
        : ADMIN_ROUTE;
      return <Navigate replace to={destination} />;
    }
    return <AuthenticatedAdmin
      currentPage={currentPage}
      developmentBypass={authState.developmentBypass}
      onRequireLogin={requireLogin}
      onSignOut={signOut}
    />;
  }

  return (
    <AdminLoginScreen
      isAuthenticating={authState.status === 'authenticating'}
      message={authState.status === 'unauthenticated' ? authState.message : undefined}
      onAuthenticate={authenticate}
    />
  );
}
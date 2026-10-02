import { Navigate, useLocation } from 'react-router-dom';
import { resolveApplicationMode } from './app/routing';
import { LocaleProvider } from './app/i18n/LocaleProvider';
import { ThemeProvider } from './app/theme/ThemeProvider';
import { AdminAuthGate } from './features/admin/AdminAuthGate';
import { FoundationHome } from './pages/FoundationHome';
import { IsolatedAccess } from './pages/IsolatedAccess';

export default function App() {
  const location = useLocation();
  const mode = resolveApplicationMode(location.pathname, location.search);

  return (
    <LocaleProvider>
      <ThemeProvider>
        {mode === 'admin' ? <AdminAuthGate /> : mode === 'isolated' ? <IsolatedAccess /> : mode === 'not-found' ? <Navigate to="/" replace /> : (
          <FoundationHome mode="public" />
        )}
      </ThemeProvider>
    </LocaleProvider>
  );
}
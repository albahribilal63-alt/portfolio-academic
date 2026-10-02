import { useState, type FormEvent } from 'react';
import { BookOpen } from 'lucide-react';
import { ThemeToggle } from '../../../app/theme/ThemeToggle';
import { LocaleSwitcher } from '../../../app/i18n/LocaleSwitcher';
import { useLocale } from '../../../app/i18n/LocaleProvider';
import { AppShell } from '../../../components/layout/AppShell';
import { Button } from '../../../components/ui/Button';

interface AdminLoginScreenProps {
  isAuthenticating: boolean;
  message?: string;
  onAuthenticate: (email: string, password: string) => Promise<void>;
}

export function AdminLoginScreen({ isAuthenticating, message, onAuthenticate }: AdminLoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { t } = useLocale();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const credentials = { email, password };
    setPassword('');
    void onAuthenticate(credentials.email, credentials.password).catch(() => undefined);
  }

  return (
    <AppShell className="admin-auth-shell">
      <header className="admin-auth-header">
        <div className="admin-auth-identity">
          <BookOpen aria-hidden="true" size={19} />
          <span>{t('Academic Portfolio')}</span>
          <span className="admin-auth-context">{t('Admin Portal')}</span>
        </div>
        <LocaleSwitcher />
        <ThemeToggle />
      </header>
      <main className="admin-auth-main">
        <section aria-labelledby="admin-login-title" className="admin-login-panel">
          <p className="admin-login-context">{t('Admin Portal')}</p>
          <h1 id="admin-login-title">{t('Administrator access')}</h1>
          <p className="admin-login-description">{t('Use your administrator email and password to continue.')}</p>
          <form className="admin-login-form" onSubmit={handleSubmit}>
            <label htmlFor="admin-email">{t('Email')}</label>
            <input
              autoComplete="username"
              aria-describedby={message ? 'admin-login-error' : undefined}
              disabled={isAuthenticating}
              id="admin-email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
            <label htmlFor="admin-password">{t('Password')}</label>
            <input
              autoComplete="current-password"
              aria-describedby={message ? 'admin-login-error' : undefined}
              disabled={isAuthenticating}
              id="admin-password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
            {message && <p className="admin-login-error" id="admin-login-error" role="alert">{t(message)}</p>}
            {isAuthenticating && <p className="admin-login-loading" role="status">{t('Authenticating…')}</p>}
            <Button className="admin-login-submit" disabled={isAuthenticating || !email || !password} type="submit" variant="primary">
              {t('Authenticate')}
            </Button>
          </form>
        </section>
      </main>
    </AppShell>
  );
}
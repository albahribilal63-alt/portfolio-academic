import type { RefObject } from 'react';
import { LogOut, Menu } from 'lucide-react';
import { ThemeToggle } from '../../../app/theme/ThemeToggle';
import { LocaleSwitcher } from '../../../app/i18n/LocaleSwitcher';
import { useLocale } from '../../../app/i18n/LocaleProvider';
import { Button } from '../../../components/ui/Button';
import type { GithubConnectionState } from '../types/state';

interface AdminHeaderProps {
  connection: GithubConnectionState;
  developmentBypass: boolean;
  pageTitle: 'Dashboard' | 'Academic Profile' | 'Academic Years' | 'Modules' | 'Activities' | 'Files & Assets' | 'Isolated Links';
  onMenuOpen: () => void;
  menuButtonRef: RefObject<HTMLButtonElement>;
  onSignOut: () => Promise<void>;
}

export function AdminHeader({ connection, developmentBypass, pageTitle, onMenuOpen, menuButtonRef, onSignOut }: AdminHeaderProps) {
  const { t } = useLocale();
  return (
    <header className={`admin-header${developmentBypass ? ' is-local-development' : ''}`}>
      <div className="admin-header-titles">
        <p className="admin-breadcrumb"><span>{t('Admin Portal')}</span><span aria-hidden="true">/</span><span>{t(pageTitle)}</span></p>
        <h1>{t(pageTitle)}</h1>
      </div>
      <div className="admin-header-controls">
        {developmentBypass && <span className="admin-local-development" role="status">{t('Local Development')}</span>}
        <span className={`admin-header-connection is-${connection.status}`} role="status">
          {connection.status === 'connected' ? t('GitHub Connected') : connection.status === 'loading' ? t('Checking GitHub…') : t('GitHub Unavailable')}
        </span>
        <Button className="admin-signout-button" onClick={() => { void onSignOut(); }} variant="quiet">
          <LogOut aria-hidden="true" size={16} />
          <span>{t('Sign out')}</span>
        </Button>
        <LocaleSwitcher />
        <button
          aria-label={t('Open navigation')}
          className="icon-button admin-menu-button"
          onClick={onMenuOpen}
          ref={menuButtonRef}
          type="button"
        >
          <Menu aria-hidden="true" size={19} />
        </button>
        <ThemeToggle />
      </div>
    </header>
  );
}
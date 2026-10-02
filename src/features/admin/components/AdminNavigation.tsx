import { NavLink } from 'react-router-dom';
import { ADMIN_NAVIGATION } from '../config/navigation';
import { useLocale } from '../../../app/i18n/LocaleProvider';

interface AdminNavigationProps {
  onNavigate: () => void;
  canNavigate: (to: string) => boolean;
}

export function AdminNavigation({ onNavigate, canNavigate }: AdminNavigationProps) {
  const { t } = useLocale();
  return (
    <nav aria-label={t('Admin sections')} className="admin-navigation">
      <ul>
        {ADMIN_NAVIGATION.map(({ id, label, icon: Icon, route }) => (
          <li key={id}>
            <NavLink
              className={({ isActive }) => `admin-nav-item${isActive ? ' is-active' : ''}`}
              end
              onClick={(event) => {
                if (!canNavigate(route)) {
                  event.preventDefault();
                  return;
                }
                onNavigate();
              }}
              to={route}
            >
              <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
              <span>{t(label)}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
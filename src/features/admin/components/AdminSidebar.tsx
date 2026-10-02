import { useEffect, useRef, type RefObject } from 'react';
import { BookOpen, X } from 'lucide-react';
import { Divider } from '../../../components/ui/Divider';
import { IconButton } from '../../../components/ui/IconButton';
import { AdminNavigation } from './AdminNavigation';
import { useLocale } from '../../../app/i18n/LocaleProvider';

interface AdminSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  canNavigate: (to: string) => boolean;
  returnFocusRef: RefObject<HTMLButtonElement>;
}

export function AdminSidebar({ isOpen, onClose, canNavigate, returnFocusRef }: AdminSidebarProps) {
  const { t } = useLocale();
  const sidebarRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const sidebar = sidebarRef.current;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !sidebar) return;
      const focusableElements = Array.from(sidebar.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement?.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement?.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      (previouslyFocused ?? returnFocusRef.current)?.focus();
    };
  }, [isOpen, onClose, returnFocusRef]);

  return (
    <aside
      aria-label={t('Admin Portal navigation')}
      aria-modal={isOpen || undefined}
      className={`admin-sidebar${isOpen ? ' is-open' : ''}`}
      ref={sidebarRef}
      role={isOpen ? 'dialog' : 'complementary'}
    >
      <div className="admin-sidebar-heading">
        <div className="admin-identity-mark" aria-hidden="true"><BookOpen size={20} /></div>
        <div className="admin-identity-copy">
          <strong>{t('Academic Portfolio')}</strong>
          <span>{t('Admin Portal')}</span>
        </div>
        <IconButton
          className="admin-close-button"
          label={t('Close navigation')}
          onClick={onClose}
          ref={closeButtonRef}
        >
          <X aria-hidden="true" size={19} />
        </IconButton>
      </div>
      <Divider />
      <AdminNavigation canNavigate={canNavigate} onNavigate={onClose} />
      <div className="admin-sidebar-footer">
        <Divider />
        <p>{t('Academic Portfolio & Isolated Assessment Hub')}</p>
      </div>
    </aside>
  );
}
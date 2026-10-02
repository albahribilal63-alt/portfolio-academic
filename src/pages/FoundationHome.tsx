import { BookOpen } from 'lucide-react';
import type { ApplicationMode } from '../app/routing';
import { ThemeToggle } from '../app/theme/ThemeToggle';
import { AppShell } from '../components/layout/AppShell';
import { PageContainer } from '../components/layout/PageContainer';
import { EmptyState } from '../components/ui/EmptyState';
import { LocaleSwitcher } from '../app/i18n/LocaleSwitcher';
import { useLocale } from '../app/i18n/LocaleProvider';

export function FoundationHome({ mode }: { mode: Extract<ApplicationMode, 'public' | 'isolated'> }) {
  const { t } = useLocale();
  return (
    <AppShell className="foundation-home" data-mode={mode}>
      <header className="foundation-header">
        <div className="foundation-identity">
          <BookOpen aria-hidden="true" size={19} />
          <span>{t('Academic Portfolio')}</span>
        </div>
        <LocaleSwitcher />
        <ThemeToggle />
      </header>
      <main>
        <PageContainer>
          <EmptyState title={t('No content is available yet.')} />
        </PageContainer>
      </main>
    </AppShell>
  );
}
import { BookOpen, CalendarDays, FolderOpen, UserRound } from 'lucide-react';
import { Grid } from '../../../components/layout/Grid';
import { Section } from '../../../components/layout/Section';
import { Stack } from '../../../components/layout/Stack';
import { AdminConnectionPanel } from '../components/AdminConnectionPanel';
import { AdminPageContainer } from '../components/AdminPageContainer';
import { AdminSectionCard } from '../components/AdminSectionCard';
import type { GithubConnectionState } from '../types/state';
import { ADMIN_ASSETS_ROUTE, ADMIN_MODULES_ROUTE, ADMIN_PROFILE_ROUTE, ADMIN_YEARS_ROUTE } from '../../../app/routing';
import { useLocale } from '../../../app/i18n/LocaleProvider';
import { useAdminData } from '../data/AdminDataProvider';

const dashboardSections = [
  {
    title: 'Academic Profile',
    description: "Manage the student's academic identity and institutional information.",
    icon: UserRound,
    route: ADMIN_PROFILE_ROUTE,
  },
  {
    title: 'Academic Years',
    description: 'Organize the academic years that contain the portfolio modules.',
    icon: CalendarDays,
    route: ADMIN_YEARS_ROUTE,
  },
  {
    title: 'Modules',
    description: 'Manage academic modules and their descriptions.',
    icon: BookOpen,
    route: ADMIN_MODULES_ROUTE,
  },
  {
    title: 'Files & Assets',
    description: 'Organize documents, code, and academic attachments.',
    icon: FolderOpen,
    route: ADMIN_ASSETS_ROUTE,
  },
];

interface AdminDashboardProps {
  connection: GithubConnectionState;
}

export function AdminDashboard({ connection }: AdminDashboardProps) {
  const { t } = useLocale();
  const { sha } = useAdminData();
  return (
    <AdminPageContainer>
      <Stack className="admin-dashboard-content">
        <Section aria-labelledby="dashboard-title" className="admin-dashboard-intro">
          <h2 id="dashboard-title">{t('Dashboard')}</h2>
          <p>{t('Manage your academic portfolio structure and content.')}</p>
        </Section>
        <Grid className="admin-dashboard-grid">
          {dashboardSections.map((section) => <AdminSectionCard key={section.title} {...section} title={t(section.title)} description={t(section.description)} />)}
        </Grid>
        <AdminConnectionPanel connection={connection} sha={sha} />
      </Stack>
    </AdminPageContainer>
  );
}
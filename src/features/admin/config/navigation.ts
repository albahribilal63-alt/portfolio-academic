import {
  BookOpen,
  CalendarDays,
  FolderOpen,
  LayoutDashboard,
  Link2,
  ListChecks,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { ADMIN_ACTIVITIES_ROUTE, ADMIN_ASSETS_ROUTE, ADMIN_ISOLATED_LINKS_ROUTE, ADMIN_MODULES_ROUTE, ADMIN_PROFILE_ROUTE, ADMIN_ROUTE, ADMIN_YEARS_ROUTE } from '../../../app/routing';

export interface AdminNavigationItem {
  id: string;
  label: string;
  icon: LucideIcon;
  route: string;
}

export const ADMIN_NAVIGATION: AdminNavigationItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, route: ADMIN_ROUTE },
  { id: 'academic-profile', label: 'Academic Profile', icon: UserRound, route: ADMIN_PROFILE_ROUTE },
  { id: 'academic-years', label: 'Academic Years', icon: CalendarDays, route: ADMIN_YEARS_ROUTE },
  { id: 'modules', label: 'Modules', icon: BookOpen, route: ADMIN_MODULES_ROUTE },
  { id: 'activities', label: 'Activities', icon: ListChecks, route: ADMIN_ACTIVITIES_ROUTE },
  { id: 'files-assets', label: 'Files & Assets', icon: FolderOpen, route: ADMIN_ASSETS_ROUTE },
  { id: 'isolated-links', label: 'Isolated Links', icon: Link2, route: ADMIN_ISOLATED_LINKS_ROUTE },
];
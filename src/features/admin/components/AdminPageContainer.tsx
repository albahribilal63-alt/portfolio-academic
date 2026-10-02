import type { ReactNode } from 'react';
import { PageContainer } from '../../../components/layout/PageContainer';

export function AdminPageContainer({ children }: { children: ReactNode }) {
  return <PageContainer className="admin-page-container">{children}</PageContainer>;
}
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

interface AdminSectionCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  route: string;
}

export function AdminSectionCard({ title, description, icon: Icon, route }: AdminSectionCardProps) {
  return (
    <Link className="ui-card admin-section-card" to={route}>
      <div className="admin-section-card-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.8} /></div>
      <h2>{title}</h2>
      <p>{description}</p>
    </Link>
  );
}
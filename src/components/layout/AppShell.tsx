import type { HTMLAttributes, ReactNode } from 'react';

interface AppShellProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function AppShell({ children, className = '', ...props }: AppShellProps) {
  return <div className={`app-shell ${className}`.trim()} {...props}>{children}</div>;
}
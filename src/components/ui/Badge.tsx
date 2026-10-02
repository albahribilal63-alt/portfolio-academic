import type { HTMLAttributes, ReactNode } from 'react';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

export function Badge({ children, className = '', ...props }: BadgeProps) {
  return <span className={`ui-badge ${className}`.trim()} {...props}>{children}</span>;
}
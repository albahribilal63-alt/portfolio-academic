import type { HTMLAttributes, ReactNode } from 'react';

interface GridProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Grid({ children, className = '', ...props }: GridProps) {
  return <div className={`layout-grid ${className}`.trim()} {...props}>{children}</div>;
}
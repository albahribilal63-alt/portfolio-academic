import type { HTMLAttributes, ReactNode } from 'react';

interface StackProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Stack({ children, className = '', ...props }: StackProps) {
  return <div className={`layout-stack ${className}`.trim()} {...props}>{children}</div>;
}
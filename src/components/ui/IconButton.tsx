import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, className = '', type = 'button', ...props },
  ref,
) {
  return (
    <button
      aria-label={label}
      className={`icon-button ${className}`.trim()}
      ref={ref}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
});
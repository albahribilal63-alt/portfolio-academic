import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'quiet';
}

export function Button({ className = '', variant = 'secondary', type = 'button', ...props }: ButtonProps) {
  return <button className={`ui-button ui-button--${variant} ${className}`.trim()} type={type} {...props} />;
}
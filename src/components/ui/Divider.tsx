import type { HTMLAttributes } from 'react';

export function Divider(props: HTMLAttributes<HTMLHRElement>) {
  return <hr className={`ui-divider ${props.className ?? ''}`.trim()} {...props} />;
}
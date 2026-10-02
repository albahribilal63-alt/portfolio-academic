interface LoadingStateProps {
  label: string;
}

export function LoadingState({ label }: LoadingStateProps) {
  return <div className="state-panel" role="status" aria-live="polite">{label}</div>;
}
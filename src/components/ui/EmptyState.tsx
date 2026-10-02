interface EmptyStateProps {
  title: string;
  description?: string;
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="state-panel" role="status">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  );
}
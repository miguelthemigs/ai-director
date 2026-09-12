/**
 * Teaches the screen. Never the word "nothing" (design doc §5 "Shared").
 */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onAction: () => void };
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      <p className="empty-state__body">{body}</p>
      {action ? (
        <button type="button" className="empty-state__action" onClick={action.onAction}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

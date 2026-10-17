import Link from "next/link";

/**
 * Pure presentation for an EMPTY result set after server-side authorization and filtering.
 *
 * This component must never decide whether a user has access to a branch,
 * whether an underlying clinical event exists, or whether a financial balance is zero.
 * Callers supply their own accurate, scoped explanation and permission-gated actions.
 */
export function TableEmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="table-empty-content" role="status">
      <span className="table-empty-symbol" aria-hidden="true">—</span>
      <strong className="table-empty-title">{title}</strong>
      <p className="table-empty-description">{description}</p>
      {action && (
        <Link href={action.href} className="secondary-link table-empty-action">
          {action.label}
        </Link>
      )}
    </div>
  );
}

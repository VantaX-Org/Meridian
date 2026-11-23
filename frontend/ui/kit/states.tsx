import type { ReactNode } from "react";

export function EmptyState({ heading, body, action }: { heading: string; body?: string; action?: ReactNode }) {
  return (
    <div className="mx-state" role="status">
      <p className="mx-state-h">{heading}</p>
      {body ? <p className="mx-muted">{body}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ heading, body, retryLabel, onRetry, page }: { heading: string; body?: string; retryLabel?: string; onRetry?: () => void; page?: boolean }) {
  const H = page ? "h1" : "p";
  return (
    <div className="mx-state" role="alert" data-tone="error">
      <H className="mx-state-h">{heading}</H>
      {body ? <p className="mx-muted">{body}</p> : null}
      {onRetry && retryLabel ? <button type="button" className="mx-btn" data-variant="secondary" onClick={onRetry}>{retryLabel}</button> : null}
    </div>
  );
}

export function Skeleton({ lines = 4, label }: { lines?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="mx-skeleton">
      {Array.from({ length: lines }, (_, i) => <span key={i} className="mx-skel" style={{ inlineSize: `${100 - ((i * 13) % 40)}%` }} />)}
    </div>
  );
}

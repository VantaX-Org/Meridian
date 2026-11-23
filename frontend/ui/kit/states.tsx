import type { ReactNode } from "react";
import { t } from "@/lib/v2/i18n";

/** One sentence, one action, no illustration. */
export function EmptyState({ heading, body, action }: { heading: string; body?: string; action?: ReactNode }) {
  return (
    <div className="mx-state" role="status">
      <p className="mx-state-h">{heading}</p>
      {body ? <p className="mx-muted">{body}</p> : null}
      {action}
    </div>
  );
}

/**
 * A failed request. `request` names it ("Score by run") and builds the heading when none is given. `stale` is the last good
 * data: it stays on screen under the error so a failed refresh never blanks the page.
 */
export function ErrorState({ heading, body, retryLabel, onRetry, request, stale }: { heading?: string; body?: string; retryLabel?: string; onRetry?: () => void; request?: string; stale?: ReactNode }) {
  const h = heading ?? (request ? t("{name} did not load.", { name: request }) : t("This did not load."));
  return (
    <>
      <div className="mx-state" role="alert" data-tone="error">
        <p className="mx-state-h">{h}</p>
        {body ? <p className="mx-muted">{body}</p> : null}
        {onRetry ? <button type="button" className="mx-btn" data-variant="secondary" onClick={onRetry}>{retryLabel ?? t("Retry")}</button> : null}
      </div>
      {stale ? <div className="mx-stale" data-testid="stale">{stale}</div> : null}
    </>
  );
}

export function Skeleton({ lines = 4, label }: { lines?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="mx-skeleton">
      {Array.from({ length: lines }, (_, i) => <span key={i} className="mx-skel" style={{ inlineSize: `${100 - ((i * 13) % 40)}%` }} />)}
    </div>
  );
}

/** A table header plus rows at the grid row height, so the page does not jump when data arrives. */
export function GridSkeleton({ rows = 8, cols = 4, label }: { rows?: number; cols?: number; label?: string }) {
  return (
    <div role="status" aria-label={label ?? t("Loading")} className="mx-gridskel" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {Array.from({ length: (rows + 1) * cols }, (_, i) => <span key={i} className="mx-skel" data-head={i < cols ? "" : undefined} />)}
    </div>
  );
}

/** A chart-shaped block. */
export function ChartSkeleton({ height = 96, label }: { height?: number; label?: string }) {
  return <div role="status" aria-label={label ?? t("Loading")} className="mx-chart-skel" style={{ blockSize: height }}><span className="mx-skel" /></div>;
}

/** The score and sentence block at the top of an object page. */
export function HeroSkeleton({ label }: { label?: string }) {
  return (
    <div role="status" aria-label={label ?? t("Loading")} className="mx-heroskel">
      <span className="mx-skel" data-size="title" />
      <span className="mx-skel" data-size="line" />
      <span className="mx-skel" data-size="ruler" />
    </div>
  );
}

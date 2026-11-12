"use client";

import { t } from "@/lib/v2/i18n";

/** Shape of the thing that will load. One status region says "Loading"; the bars are decoration. */
export function Skeleton({ lines = 3, label }: { lines?: number; label?: string }) {
  return (
    <div role="status" className="nx-skeleton" aria-live="polite">
      <span className="nx-sr">{label ?? t("Loading")}</span>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} aria-hidden="true" className="nx-skeleton-bar" data-last={i === lines - 1 || undefined} />
      ))}
    </div>
  );
}

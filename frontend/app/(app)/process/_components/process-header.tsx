import type { ReactNode } from "react";
import { Skeleton } from "@/design";

/**
 * Page-level header for the process area: title, one meta line, status and actions.
 * ponytail: local stand-in for the foundations `PageHeader`; swap the import once it lands.
 * The shell Breadcrumb already owns the page `<h1>`, so this renders an `<h2>`.
 */
export function ProcessHeader({ title, meta, status, actions }: {
  title: ReactNode; meta?: ReactNode; status?: ReactNode; actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="grid min-w-0 gap-1">
        <div className="flex items-center gap-2">
          <h2 className="truncate font-semibold" style={{ fontSize: 20, lineHeight: "26px", color: "var(--m-ink)" }}>{title}</h2>
          {status}
        </div>
        {meta && <p style={{ fontSize: 13, lineHeight: "18px", color: "var(--m-ink-2)" }}>{meta}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Final-geometry loading frame: header, 112px insight strip, table rows. Never one tall block. */
export function ProcessSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div className="grid gap-4" data-state="loading">
      <Skeleton height={52} />
      <Skeleton height={112} />
      <RowsSkeleton rows={rows} />
    </div>
  );
}

export function RowsSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div className="grid gap-1" data-state="loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} height={36} />)}
    </div>
  );
}

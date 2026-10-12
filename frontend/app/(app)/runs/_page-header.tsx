// frontend/app/(app)/runs/_page-header.tsx
// Stand-in for the design/ PageHeader (Task 1). Same props; swap the import once it lands.
import type { ReactNode } from "react";
import { Skeleton } from "@/design";

export function RunsPageHeader({
  title, meta, status, actions,
}: { title: ReactNode; meta?: ReactNode; status?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4" style={{ minHeight: 48 }}>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line aurora-structure/one-h1 -- stand-in until design/ PageHeader lands */}
          <h1 className="truncate font-semibold" style={{ fontSize: "var(--m-text-title)", lineHeight: "var(--m-leading-title)", color: "var(--m-ink)" }}>{title}</h1>
          {status}
        </div>
        {meta ? <p style={{ fontSize: "var(--m-text-body)", lineHeight: "var(--m-leading-body)", color: "var(--m-ink-2)" }}>{meta}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Final-height placeholder for the header: no layout shift when the run arrives. */
export const RunsPageHeaderSkeleton = () => <Skeleton height={48} />;

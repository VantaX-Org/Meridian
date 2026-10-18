import type { ReactNode } from "react";
import { Skeleton } from "@/design";

/** Page frame shared by the process pages: centred, padded from the page tokens. */
export function ProcessFrame({ children }: { children: ReactNode }) {
  return <div className="mx-auto grid w-full gap-4 [padding:var(--m-page-pad)] [max-width:var(--m-page-max)]">{children}</div>;
}

/** Final-geometry loading frame: header, 112px insight strip, table rows. Never one tall block. */
export function ProcessSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div className="grid gap-4" data-state="pending">
      <Skeleton height={52} />
      <Skeleton height={112} />
      <RowsSkeleton rows={rows} />
    </div>
  );
}

export function RowsSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div className="grid gap-1" data-state="pending">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} height={44} />)}
    </div>
  );
}

/** Under an always-rendered PageHeader: 112px insight strip plus table rows. */
export function BodySkeleton({ rows = 7 }: { rows?: number }) {
  return (<><Skeleton height={112} /><RowsSkeleton rows={rows} /></>);
}

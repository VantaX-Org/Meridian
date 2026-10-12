import { Skeleton } from "@/design";

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
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} height={36} />)}
    </div>
  );
}

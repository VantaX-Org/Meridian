// frontend/design/templates/ReportPage.tsx
import type { ReactNode } from "react";
import { Button } from "../primitives/Button";
import { EmptyState } from "../primitives/EmptyState";
import { ErrorState } from "../primitives/ErrorState";
import { Skeleton } from "../primitives/Skeleton";

export function ReportPage({
  narrative,
  charts,
  tables,
  onExport,
  state,
  emptyProps,
  errorProps,
}: {
  narrative: string;
  charts: ReactNode;
  tables?: ReactNode;
  onExport?: () => void;
  /** Swaps the charts/tables region for a skeleton, empty or error state. */
  state?: "loading" | "empty" | "error";
  emptyProps?: { title: string; action?: ReactNode };
  errorProps?: { message: string; onRetry?: () => void };
}) {
  let body: ReactNode = (
    <>
      {charts}
      {tables}
    </>
  );
  if (state === "loading") {
    body = (
      <div className="flex flex-col gap-2">
        <Skeleton height={240} />
        <Skeleton height={120} />
      </div>
    );
  } else if (state === "empty") {
    body = <EmptyState title={emptyProps?.title ?? "Nothing to show"} action={emptyProps?.action} />;
  } else if (state === "error") {
    body = <ErrorState message={errorProps?.message ?? "Something went wrong"} onRetry={errorProps?.onRetry} />;
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink)" }}>{narrative}</p>
      {body}
      {onExport && <Button variant="secondary" onClick={onExport}>Export</Button>}
    </div>
  );
}

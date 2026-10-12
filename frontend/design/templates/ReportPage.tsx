// frontend/design/templates/ReportPage.tsx
import { PageFrame } from "./PageFrame";
import type { ReactNode } from "react";
import { Button } from "../primitives/Button";
import { PageHeader } from "../primitives/PageHeader";
import { EmptyState, type EmptyStateGhost } from "../primitives/EmptyState";
import { ErrorState } from "../primitives/ErrorState";
import { Skeleton } from "../primitives/Skeleton";

export function ReportPage({
  title,
  meta,
  header,
  narrative,
  charts,
  tables,
  onExport,
  exportMenu,
  state,
  emptyProps,
  errorProps,
  loading,
}: {
  /** Replaces the default skeleton while `state` is "loading", so a page can match its real geometry. */
  loading?: ReactNode;
  /** Page title, rendered by `PageHeader` as an h2 (the shell Breadcrumb owns the single h1). With `title` set, `exportMenu` sits in the header actions. */
  title?: string;
  /** One line under the title: run label, as-of time, scope. */
  meta?: ReactNode;
  /** Optional page header rendered above the narrative row. Use `title` instead for a standard header. */
  header?: ReactNode;
  narrative: ReactNode;
  charts: ReactNode;
  tables?: ReactNode;
  /** @deprecated use `exportMenu`; ignored once `exportMenu` is set. */
  onExport?: () => void;
  /** Rendered in the page header row, right-aligned. Suppresses the legacy bottom `onExport` button. */
  exportMenu?: ReactNode;
  /** Swaps the charts/tables region for a skeleton, empty or error state. */
  state?: "loading" | "empty" | "error";
  emptyProps?: { title: string; detail?: string; action?: ReactNode; ghost?: EmptyStateGhost };
  errorProps?: { message: string; onRetry?: () => void };
}) {
  let body: ReactNode = (
    <>
      {charts}
      {tables}
    </>
  );
  if (state === "loading") {
    body = loading ?? (
      <div className="m-motion-stagger flex flex-col gap-2" data-state="loading">
        <Skeleton height={240} />
        <Skeleton height={120} />
      </div>
    );
  } else if (state === "empty") {
    body = (
      <EmptyState
        title={emptyProps?.title ?? "Nothing to show"}
        detail={emptyProps?.detail}
        action={emptyProps?.action}
        ghost={emptyProps?.ghost ?? "chart"}
      />
    );
  } else if (state === "error") {
    body = <ErrorState message={errorProps?.message ?? "Something went wrong"} onRetry={errorProps?.onRetry} />;
  }

  return (
    <PageFrame gap={4}>
      {title ? <PageHeader title={title} meta={meta} actions={exportMenu} /> : header}
      <div className="flex items-start justify-between gap-4">
        <div className="m-text-body" style={{ color: "var(--m-ink)" }}>{narrative}</div>
        {title ? null : exportMenu}
      </div>
      {body}
      {!exportMenu && onExport && <Button variant="secondary" onClick={onExport}>Export</Button>}
    </PageFrame>
  );
}

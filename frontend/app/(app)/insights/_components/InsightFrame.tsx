"use client";

// Page frame for every insight page: header (title, run label, the shared action bar and the view
// tabs), the four-sentence InsightHeader, then the cards. The spine is owned here so no page can
// drop a piece of it.
import type { ReactNode } from "react";
import { Card, EmptyState, PageHeader, ErrorState, InsightHeader, Skeleton, type EmptyStateGhost, type ExportOption, type PillTone, type InsightHeaderProps } from "@/design";
import { useLoadingTimeout } from "@/design/hooks/useLoadingTimeout";
import { useRunListWith } from "@/hooks/use-run-list";
import { formatDate } from "@/lib/format";
import { InsightActions } from "./InsightActions";
import { InsightTabs } from "./InsightViews";

export { formatMoney } from "@/lib/format";

/** Human label for a run id from the run list the shell already loads (or the run read by id), never the raw id. */
export function useRunLabel(versionId?: string | null): string | undefined {
  const { run: v } = useRunListWith(versionId);
  return v ? v.label || formatDate(v.run_at, "datetime") : undefined;
}

export interface InsightFrameProps {
  title: string;
  /** Run label or one line of context. */
  meta?: ReactNode;
  /**
   * The whole action slot. Leave it out and the frame renders the standard `InsightActions` bar for
   * `run` and `module`, with `controls` (page-specific selects or buttons) in front of it.
   */
  actions?: ReactNode;
  controls?: ReactNode;
  run?: string;
  module?: string;
  /** Extra export formats added before the failing-records list. */
  exportOptions?: ExportOption[];
  insight?: InsightHeaderProps;
  state?: "loading" | "empty" | "error";
  emptyProps?: { title: string; detail?: string; action: ReactNode; ghost?: EmptyStateGhost };
  errorProps?: { message: string; onRetry?: () => void };
  /** Loading body shaped like the final cards so nothing shifts. */
  skeleton?: ReactNode;
  children?: ReactNode;
}

/** Status text from the API to a pill tone: degraded and at-risk are amber, only blocked or no-go is red. */
export function statusTone(status: string): PillTone {
  const s = status.toLowerCase().replace(/[\s_]+/g, "-");
  if (s === "go" || s === "ready" || s === "passed") return "go";
  if (s === "no-go" || s === "blocked" || s === "failed") return "no-go";
  if (s === "at-risk" || s === "degraded" || s === "warning") return "at-risk";
  return "neutral";
}

/** A Card-shaped placeholder at the final body height. */
export function CardSkeleton({ height }: { height: number }) {
  return (
    <Card>
      <Skeleton height={height} />
    </Card>
  );
}

export const SLOW_LOAD_MESSAGE = "This is taking longer than expected.";

export function InsightFrame({
  title, meta, actions, controls, run, module, exportOptions, insight, state, emptyProps, errorProps, skeleton, children,
}: InsightFrameProps) {
  // A skeleton that never resolves becomes an error with Retry after the shared timeout.
  const stuck = useLoadingTimeout(state === "loading");
  const retry = errorProps?.onRetry ?? (() => window.location.reload());
  let body: ReactNode = children;
  if (state === "loading" && stuck) {
    body = <ErrorState title={SLOW_LOAD_MESSAGE} message="The server has not answered. Retry, or check the job tray." onRetry={retry} />;
  } else if (state === "loading") {
    body = (
      <div aria-busy="true" className="flex flex-col gap-4">
        {skeleton ?? <CardSkeleton height={240} />}
      </div>
    );
  } else if (state === "empty" && emptyProps) {
    body = <EmptyState title={emptyProps.title} detail={emptyProps.detail} action={emptyProps.action} ghost={emptyProps.ghost ?? "chart"} />;
  } else if (state === "error") {
    body = <ErrorState message={errorProps?.message ?? "Something went wrong"} onRetry={errorProps?.onRetry} />;
  }
  const actionBar = actions ?? (
    <div className="flex flex-wrap items-center gap-2">
      {controls}
      <InsightActions run={run} module={module} options={exportOptions} />
    </div>
  );
  return (
    <div className="mx-auto flex w-full flex-col" style={{ gap: "var(--m-section-gap)", padding: "var(--m-page-pad)", maxWidth: "var(--m-page-max)" }}>
      <PageHeader title={title} meta={meta} actions={actionBar} tabs={<InsightTabs />} />
      {insight && state !== "empty" && state !== "error" && !(state === "loading" && stuck) && (
        <InsightHeader {...insight} loading={insight.loading ?? state === "loading"} />
      )}
      {body}
    </div>
  );
}

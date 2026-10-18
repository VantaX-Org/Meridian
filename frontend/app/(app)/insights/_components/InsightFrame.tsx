"use client";

// Page frame for every insight page: header (title, run label, the shared action bar and the view
// tabs), the four-sentence InsightHeader, then the cards. The spine is owned here so no page can
// drop a piece of it.
import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Async, Card, PageHeader, InsightHeader, Skeleton, type AsyncError, type AsyncState, type EmptyStateGhost, type ExportOption, type PillTone, type InsightHeaderProps } from "@/design";
import { useLoadingTimeout } from "@/design/hooks/useLoadingTimeout";
import { useRunListWith } from "@/hooks/use-run-list";
import { useRunScope } from "@/hooks/use-run-scope";
import { RunScope } from "@/components/run-scope";
import { hrefWithRun } from "@/lib/run-scope";
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
  /** One line of context; with `scope` it follows the "As of" run line. */
  meta?: ReactNode;
  /**
   * The page's numbers come from the scoped run (`useInsightScope().run`): the header names it ("As of ..."),
   * offers the other runs of its lineage, and "Back to latest" while `?run=` pins an older one.
   */
  scope?: boolean;
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
  /** The body's state (`Async`); default "ready". */
  state?: AsyncState;
  emptyProps?: { title: string; detail?: string; action: ReactNode; ghost?: EmptyStateGhost };
  errorProps?: AsyncError;
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

/** The "As of" line of an insight page: the scoped run, a picker of its lineage, "Back to latest". */
function InsightRunScope() {
  const scope = useRunScope();
  // Both hooks return null outside the App Router (unit tests, static export).
  const pathname = usePathname() ?? "";
  const search = useSearchParams();
  return <RunScope scope={scope} picker hrefFor={(id) => hrefWithRun(pathname, search, id)} />;
}

export { SLOW_LOAD_MESSAGE } from "@/design";

export function InsightFrame({
  title, meta, scope, actions, controls, run, module, exportOptions, insight, state, emptyProps, errorProps, skeleton, children,
}: InsightFrameProps) {
  // A skeleton that never resolves becomes an error with Retry after the shared timeout (inside Async); the
  // header gives way with it.
  const stuck = useLoadingTimeout(state === "loading");
  // Empty without empty copy keeps the children (a page that renders its own empty cards).
  const body = (
    <Async
      state={state === "empty" && !emptyProps ? "ready" : state}
      skeleton={<div className="flex flex-col gap-4">{skeleton ?? <CardSkeleton height={240} />}</div>}
      empty={emptyProps && { ...emptyProps, ghost: emptyProps.ghost ?? "chart" }}
      error={errorProps ?? { message: "Something went wrong" }}
    >
      {children}
    </Async>
  );
  const actionBar = actions ?? (
    <div className="flex flex-wrap items-center gap-2">
      {controls}
      <InsightActions run={run} module={module} options={exportOptions} />
    </div>
  );
  return (
    <div className="mx-auto flex w-full flex-col [gap:var(--m-section-gap)] [padding:var(--m-page-pad)] [max-width:var(--m-page-max)]">
      <PageHeader
        title={title}
        meta={scope ? (
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <InsightRunScope />
            {meta != null && meta !== "" && <span>{meta}</span>}
          </span>
        ) : meta}
        actions={actionBar}
        tabs={<InsightTabs />}
      />
      {insight && state !== "empty" && state !== "error" && !(state === "loading" && stuck) && (
        <InsightHeader {...insight} loading={insight.loading ?? state === "loading"} />
      )}
      {body}
    </div>
  );
}

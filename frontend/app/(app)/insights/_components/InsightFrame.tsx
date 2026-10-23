"use client";

// Page frame for every insight page: header (title, run label, the shared action bar and the view
// tabs), the four-sentence InsightHeader, then the cards. The spine is owned here so no page can
// drop a piece of it.
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Async, Card, PageFrame, PageHeader, InsightHeader, Select, Skeleton, type AsyncError, type AsyncState, type EmptyStateGhost, type ExportOption, type PillTone, type InsightHeaderProps } from "@/design";
import { useLoadingTimeout } from "@/design/hooks/useLoadingTimeout";
import { useRunListWith } from "@/hooks/use-run-list";
import { RunScope } from "@/components/run-scope";
import { stateScopeLine } from "@/lib/current-state";
import { hrefWithRun, runChoiceLabels } from "@/lib/run-scope";
import { formatDate } from "@/lib/format";
import { InsightActions } from "./InsightActions";
import { InsightTabs } from "./InsightViews";
import { CURRENT_STATE_VIEWS, insightRunChoices } from "./scopeMode";
import { useCurrentState } from "./useCurrentState";
import { useInsightScope } from "./useInsightScope";

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
   * The page takes its scope from `useInsightScope()`. In "run" mode its numbers come from the scoped run
   * (`useInsightScope().run`): the header says "One run", names it ("As of ..."), offers the other runs of its
   * lineage and the latest run of every other one, and "Back to latest" while `?run=` pins an older one. In
   * "current" mode (a view in `CURRENT_STATE_VIEWS` without `?run=` or `?module=`) the header says "Current state
   * of N objects, latest run <date>" and offers one run instead.
   */
  scope?: boolean;
  /**
   * The whole action slot. Leave it out and the frame renders the standard `InsightActions` bar for
   * `run` and `module`, with `controls` (page-specific selects or buttons) in front of it.
   */
  actions?: ReactNode;
  controls?: ReactNode;
  /** A row of page-specific controls under the tabs (a baseline picker, a window select), kept out of the action bar. */
  toolbar?: ReactNode;
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

/**
 * The one-run header line: "One run", "As of" the scoped run with a picker of its lineage and of every other
 * lineage's latest run, "Back to latest" while pinned. On a view that can show the current state, the way back is
 * "Back to current state" instead.
 */
function InsightRunScope() {
  const { scope, explicit } = useInsightScope();
  // Both hooks return null outside the App Router (unit tests, static export).
  const pathname = usePathname() ?? "";
  const search = useSearchParams();
  const canShowCurrent = CURRENT_STATE_VIEWS.includes(pathname);
  if (!scope.run) return null;
  const choices = insightRunChoices(scope.run, scope.versions);
  return (
    <span data-testid="insight-scope" data-scope="run" className="inline-flex flex-wrap items-center gap-2">
      <span className="font-medium m-ink">One run</span>
      <RunScope
        scope={{ run: scope.run, latestId: canShowCurrent ? undefined : scope.latestId, pinned: canShowCurrent ? false : scope.pinned, choices }}
        picker
        hrefFor={(id) => hrefWithRun(pathname, search, id)}
      />
      {canShowCurrent && explicit && (
        <Link href={hrefWithRun(pathname, search, null)} className="m-ink-accent underline-offset-2 hover:underline">Back to current state</Link>
      )}
    </span>
  );
}

/** The current-state header line: what the numbers cover, and a picker that opens one run instead. */
function InsightCurrentScope() {
  const { objects, runs, newest } = useCurrentState();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const search = useSearchParams();
  if (!newest) return null;
  const labels = runChoiceLabels(runs);
  return (
    <span data-testid="insight-scope" data-scope="current" className="inline-flex flex-wrap items-center gap-2">
      <span data-testid="run-scope">{stateScopeLine(objects.length, newest.run_at)}</span>
      <Select
        label="Showing"
        value="current"
        onValueChange={(id) => {
          if (id && id !== "current") router.replace(hrefWithRun(pathname, search, id), { scroll: false });
        }}
        options={[{ value: "current", label: "Current state" }, ...runs.map((r) => ({ value: r.id, label: labels.get(r.id) ?? r.id }))]}
        className="m-input inline-flex max-w-[320px] items-center justify-between gap-2"
      />
    </span>
  );
}

/** The scope line of the header: the current state across objects, or one run. */
function InsightScopeLine() {
  const { mode } = useInsightScope();
  return mode === "current" ? <InsightCurrentScope /> : <InsightRunScope />;
}

export { SLOW_LOAD_MESSAGE } from "@/design";

export function InsightFrame({
  title, meta, scope, actions, controls, toolbar, run, module, exportOptions, insight, state, emptyProps, errorProps, skeleton, children,
}: InsightFrameProps) {
  // A skeleton that never resolves becomes an error with Retry after the shared timeout (inside Async); the
  // header gives way with it.
  const stuck = useLoadingTimeout(state === "loading");
  // Empty without empty copy keeps the children (a page that renders its own empty cards).
  const body = (
    <Async
      state={state === "empty" && !emptyProps ? "ready" : state}
      skeleton={<div aria-busy="true" className="flex flex-col gap-4">{skeleton ?? <CardSkeleton height={240} />}</div>}
      empty={emptyProps && { ...emptyProps, ghost: emptyProps.ghost ?? "chart" }}
      error={errorProps ?? { message: "Something went wrong" }}
    >
      {children}
    </Async>
  );
  const showInsight = !!insight && state !== "empty" && state !== "error" && !(state === "loading" && stuck);
  const actionBar = actions ?? (
    <div className="flex flex-wrap items-center gap-2">
      {controls}
      <InsightActions run={run} module={module} options={exportOptions} />
    </div>
  );
  return (
    // PageFrame pads once: the (app) layout's frame already pads, so a second padding doubled the gutter.
    <PageFrame style={{ gap: "var(--m-section-gap)" }}>
      <PageHeader
        title={title}
        meta={scope ? (
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <InsightScopeLine />
            {meta != null && meta !== "" && <span>{meta}</span>}
          </span>
        ) : meta}
        actions={actionBar}
        tabs={<InsightTabs />}
      />
      {toolbar && <div className="flex flex-wrap items-end gap-2">{toolbar}</div>}
      <div className="flex flex-col [gap:var(--m-section-gap)]">
        {showInsight && <InsightHeader {...insight} loading={insight.loading ?? state === "loading"} />}
        {body}
      </div>
    </PageFrame>
  );
}

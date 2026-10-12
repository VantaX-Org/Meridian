"use client";

// Page frame for every insight page: header (title, run label, actions), the four-sentence
// InsightHeader, then the cards.
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, EmptyState, PageHeader, ErrorState, InsightHeader, Skeleton, type EmptyStateGhost, type PillTone, type InsightHeaderProps } from "@/design";
import { getVersions } from "@/lib/api/versions";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

/** Human label for a run id from the run list the shell already loads, never the raw id. */
export function useRunLabel(versionId?: string | null): string | undefined {
  const { data } = useQuery({ queryKey: queryKeys.run("list"), queryFn: () => getVersions() });
  const v = data?.versions.find((x) => x.id === versionId);
  return v ? v.label || formatDate(v.run_at, "datetime") : undefined;
}

export interface InsightFrameProps {
  title: string;
  /** Run label or one line of context. */
  meta?: ReactNode;
  actions?: ReactNode;
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

/** Currency amounts use the code the API sends, in the viewer's locale. */
export function formatMoney(n: number, currency?: string | null): string {
  const base = { maximumFractionDigits: 0 };
  try {
    return currency
      ? new Intl.NumberFormat(undefined, { ...base, style: "currency", currency, currencyDisplay: "code" }).format(n)
      : new Intl.NumberFormat(undefined, base).format(n);
  } catch {
    return `${new Intl.NumberFormat(undefined, base).format(n)} ${currency ?? ""}`.trim();
  }
}

export function InsightFrame({ title, meta, actions, insight, state, emptyProps, errorProps, skeleton, children }: InsightFrameProps) {
  let body: ReactNode = children;
  if (state === "loading") {
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
  return (
    <div className="mx-auto flex w-full flex-col gap-4" style={{ padding: "var(--m-page-pad)", maxWidth: "var(--m-page-max)" }}>
      <PageHeader title={title} meta={meta} actions={actions} />
      {insight && state !== "empty" && state !== "error" && (
        <InsightHeader {...insight} loading={insight.loading ?? state === "loading"} />
      )}
      {body}
    </div>
  );
}

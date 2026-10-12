"use client";

// Page frame for every insight page: header (title, run label, actions), the four-sentence
// InsightHeader, then the cards. Local stand-in for the foundations PageHeader; swap when it lands.
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorState, InsightHeader, Skeleton, type EmptyStateGhost, type InsightHeaderProps } from "@/design";
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
  insight?: Omit<InsightHeaderProps, "loading">;
  state?: "loading" | "empty" | "error";
  emptyProps?: { title: string; detail?: string; action: ReactNode; ghost?: EmptyStateGhost };
  errorProps?: { message: string; onRetry?: () => void };
  children?: ReactNode;
}

export function InsightFrame({ title, meta, actions, insight, state, emptyProps, errorProps, children }: InsightFrameProps) {
  let body: ReactNode = children;
  if (state === "loading") {
    body = (
      <div data-state="loading" className="flex flex-col gap-4">
        <Skeleton height={240} />
        <Skeleton height={120} />
      </div>
    );
  } else if (state === "empty" && emptyProps) {
    body = <EmptyState title={emptyProps.title} detail={emptyProps.detail} action={emptyProps.action} ghost={emptyProps.ghost ?? "chart"} />;
  } else if (state === "error") {
    body = <ErrorState message={errorProps?.message ?? "Something went wrong"} onRetry={errorProps?.onRetry} />;
  }
  return (
    <div className="mx-auto flex w-full flex-col gap-4" style={{ padding: "var(--m-page-pad)", maxWidth: "var(--m-page-max)" }}>
      <header className="flex items-start justify-between gap-4" style={{ minHeight: 48 }}>
        <div className="grid gap-1">
          <h1 className="font-semibold" style={{ fontSize: "var(--m-text-title)", lineHeight: "var(--m-leading-title)", color: "var(--m-ink)" }}>{title}</h1>
          {meta != null && <p style={{ fontSize: "var(--m-text-body)", lineHeight: "var(--m-leading-body)", color: "var(--m-ink-2)" }}>{meta}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
      {insight && state !== "empty" && state !== "error" && (
        <InsightHeader {...insight} loading={state === "loading"} />
      )}
      {body}
    </div>
  );
}

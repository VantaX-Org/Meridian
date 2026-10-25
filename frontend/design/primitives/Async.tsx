"use client";

import type { ReactNode } from "react";
import { apiErrorState, isNotFound } from "@/lib/error";
import { useLoadingTimeout } from "../hooks/useLoadingTimeout";
import { EmptyState, type EmptyStateGhost } from "./EmptyState";
import { ErrorState } from "./ErrorState";
import { Skeleton, StatSkeleton, TableRowsSkeleton } from "./Skeleton";

/** The one state set for a region that loads: every template and `Async` speak it. */
export type AsyncState = "loading" | "empty" | "error" | "ready";

/** Placeholder in the final geometry: a named shape, a height in px for a plain block, or a node shaped like the real content. */
export type AsyncSkeleton = "table" | "chart" | "stats" | "list" | number | ReactNode;

export interface AsyncEmpty {
  title: string;
  detail?: string;
  action?: ReactNode;
  ghost?: EmptyStateGhost;
  /** "inline" for a region inside a card: one line, no ghost or chrome. */
  variant?: "card" | "inline";
}

export interface AsyncError {
  /** Defaults to the network sentence; `apiErrorState` fills it from a failed query. */
  title?: string;
  message: string;
  onRetry?: () => void;
}

/** The slice of a TanStack query `Async` reads. */
export interface AsyncQuery<T> {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  data: T | undefined;
  refetch?: () => unknown;
}

export const SLOW_LOAD_MESSAGE = "This is taking longer than expected.";

function skeletonFor(s: AsyncSkeleton | undefined): ReactNode {
  if (s === undefined || s === "chart") return <Skeleton height={240} />;
  if (typeof s === "number") return <Skeleton height={s} />;
  if (s === "table") return <TableRowsSkeleton />;
  if (s === "list") return <TableRowsSkeleton rows={4} />;
  if (s === "stats") return <div className="m-stat-grid">{[0, 1, 2, 3].map((i) => <StatSkeleton key={i} />)}</div>;
  return s;
}

/** The state a query is in: loading, error (a 404 counts as empty when `notFoundIsEmpty`), empty, or ready. */
export function asyncStateOf<T>(q: AsyncQuery<T>, isEmpty?: (data: T) => boolean, notFoundIsEmpty = false): AsyncState {
  if (q.isLoading) return "loading";
  if (q.isError) return notFoundIsEmpty && isNotFound(q.error) ? "empty" : "error";
  // A disabled query (no data, not fetching) has nothing to show.
  if (q.data === undefined || isEmpty?.(q.data)) return "empty";
  return "ready";
}

/**
 * Loading, empty and error for one region, in one place.
 *
 *   <Async query={q} skeleton="table" isEmpty={(d) => d.items.length === 0} empty={{ title: "No rules yet", action }}>
 *     {(d) => <DataTable data={d.items} ... />}
 *   </Async>
 *
 * With `query`, the state comes from the query and a failure reads through `apiErrorState` with Retry refetching it.
 * Templates pass `state` (and `error`) instead. A skeleton that never resolves gives way to an error with Retry after
 * the shared timeout.
 */
export function Async<T>({ query, state, isEmpty, notFoundIsEmpty, skeleton, empty, error, children }: {
  query?: AsyncQuery<T>;
  state?: AsyncState;
  isEmpty?: (data: T) => boolean;
  /** A 404 from a list endpoint means "nothing yet": show `empty`, not an error. */
  notFoundIsEmpty?: boolean;
  skeleton?: AsyncSkeleton;
  empty?: AsyncEmpty;
  /** Overrides the error a failed `query` would show, or supplies it for `state="error"`. */
  error?: AsyncError;
  children: ReactNode | ((data: T) => ReactNode);
}) {
  const s: AsyncState = state ?? (query ? asyncStateOf(query, isEmpty, notFoundIsEmpty) : "ready");
  const stuck = useLoadingTimeout(s === "loading");
  const retry = error?.onRetry ?? (query?.refetch ? () => void query.refetch?.() : undefined);
  if (s === "loading" && stuck) {
    return <ErrorState title={SLOW_LOAD_MESSAGE} message="The server has not answered. Retry, or check the job tray." onRetry={retry ?? (() => window.location.reload())} />;
  }
  if (s === "loading") {
    return (
      <div data-state="loading" aria-busy="true">
        <span role="status" className="sr-only">Loading</span>
        {skeletonFor(skeleton)}
      </div>
    );
  }
  if (s === "error") {
    const e = error ?? (query ? apiErrorState(query.error) : { message: "Something went wrong" });
    return <ErrorState title={e.title} message={e.message} onRetry={retry} />;
  }
  if (s === "empty" && empty) {
    return <EmptyState title={empty.title} detail={empty.detail} action={empty.action} ghost={empty.ghost} variant={empty.variant} />;
  }
  // Ready, or empty with no `empty` copy: the children (a region that renders its own empty line).
  return <>{typeof children === "function" ? (query?.data !== undefined ? children(query.data) : null) : children}</>;
}

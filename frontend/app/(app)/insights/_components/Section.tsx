"use client";

import type { ReactNode } from "react";
import { Button, Card, Skeleton } from "@/design";
import { useLoadingTimeout } from "@/design/hooks/useLoadingTimeout";
import { apiErrorMessage } from "@/lib/error";

/**
 * A Card whose body follows one query: a skeleton at the final height while loading,
 * an inline error with Retry on failure (never the whole page), else the children.
 */
export function Section({
  title, meta, actions, height, query, children,
}: {
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  /** Body height while loading, so nothing shifts. */
  height: number;
  query: { isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  children: ReactNode;
}) {
  // A card whose query never answers offers Retry after the shared timeout, like the page frame does.
  const stuck = useLoadingTimeout(query.isLoading);
  return (
    <Card title={title} meta={meta} actions={actions}>
      {query.isLoading && stuck ? (
        <div role="alert" className="flex items-center gap-3 m-text-body">
          <span>{`${title} is taking longer than expected.`}</span>
          <Button variant="secondary" onClick={() => void query.refetch()}>Retry</Button>
        </div>
      ) : query.isLoading ? (
        <div aria-busy="true"><Skeleton height={height} /></div>
      ) : query.isError ? (
        <div role="alert" className="flex items-center gap-3 m-text-body">
          <span>{`${title} did not load. ${apiErrorMessage(query.error)}`}</span>
          <Button variant="secondary" onClick={() => void query.refetch()}>Retry</Button>
        </div>
      ) : children}
    </Card>
  );
}

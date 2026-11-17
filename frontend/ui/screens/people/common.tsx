"use client";

import type { ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { ErrorState, Skeleton } from "@/ui/kit";

export { refreshV2 } from "@/lib/v2/queries";

/** One read for this batch. Every key starts with "v2", so refreshV2 reaches it. */
export function useQ<T>(key: unknown[], fn: () => Promise<T>, enabled = true): UseQueryResult<T> {
  const fx = useFixture();
  return useQuery({ queryKey: ["v2", "p9", ...key, fx], queryFn: fn, staleTime: 15000, enabled });
}

/** The day of an ISO time, or a word when there is none. */
export const day = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : t("Never"));

/** Skeleton while loading, an error line when it failed, else the body. */
export function Gate<T>({ q, label, children }: { q: UseQueryResult<T>; label: string; children: (data: T) => ReactNode }) {
  if (q.isPending) return <Skeleton lines={6} label={label} />;
  if (q.isError || q.data === undefined) return <ErrorState heading={t("This could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />;
  return <>{children(q.data)}</>;
}

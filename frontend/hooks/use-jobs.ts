"use client";

import { toast } from "sonner";
import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { getJobs, streamJobs } from "@/lib/api/jobs";
import type { Job } from "@/types/jobs";

export const JOBS_QUERY_KEY = ["jobs"] as const;
const ACTIVE = new Set(["queued", "running"]);

/**
 * True for a query key whose first element is in `touches`. Absent `touches`
 * matches nothing — the caller is expected to offer a manual "Refresh" toast
 * instead of guessing (spec section 9.1).
 */
export function touchedPredicate(touches: string[] | undefined) {
  const set = new Set(touches ?? []);
  return (query: { queryKey: QueryKey }) => set.has(String(query.queryKey[0]));
}

/**
 * The tenant's jobs, kept live: one SSE stream patches the react-query cache
 * (newest first), with a 15 s poll as the fallback while the stream is down.
 * Mount once in the shell; read anywhere with `useJobs()`.
 */
export function useJobStream(): void {
  const qc = useQueryClient();
  useEffect(() => {
    let stop: (() => void) | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let delay = 2_000;
    const connect = () => {
      stop = streamJobs(
        (job) => {
          delay = 2_000;
          qc.setQueryData<Job[]>(JOBS_QUERY_KEY, (prev = []) => [
            job,
            ...prev.filter((j) => j.id !== job.id),
          ]);
          if (job.status === "completed") {
            if (job.touches && job.touches.length > 0) {
              qc.invalidateQueries({ predicate: touchedPredicate(job.touches) });
            } else {
              toast(`${job.label} finished`, {
                action: { label: "Refresh", onClick: () => qc.invalidateQueries() },
              });
            }
          }
        },
        () => {
          retry = setTimeout(connect, delay);
          delay = Math.min(delay * 2, 30_000);
        },
      );
    };
    connect();
    return () => {
      stop?.();
      if (retry) clearTimeout(retry);
    };
  }, [qc]);
}

export function useJobs() {
  const q = useQuery({
    queryKey: JOBS_QUERY_KEY,
    queryFn: () => getJobs({ limit: 100 }),
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
  const jobs = q.data ?? [];
  return { ...q, jobs, active: jobs.filter((j) => ACTIVE.has(j.status)) };
}

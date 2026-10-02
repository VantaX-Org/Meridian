"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getJobs, streamJobs } from "@/lib/api/jobs";
import type { Job } from "@/types/jobs";

export const JOBS_QUERY_KEY = ["jobs"] as const;
const ACTIVE = new Set(["queued", "running"]);

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
            // a finished job changed data the pages show
            qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "jobs" });
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

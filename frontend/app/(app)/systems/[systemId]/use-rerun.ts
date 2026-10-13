"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiErrorMessage } from "@/lib/error";

/** The worker has no job-registry entry, so after it is queued the result lists are refetched on a short schedule. */
const REFRESH_AFTER_MS = [4_000, 12_000, 30_000];

/**
 * Queues an intelligence rerun, then refetches `queryKey` while the worker finishes.
 */
export function useRerun(opts: { run: () => Promise<unknown>; queryKey: QueryKey; queued: string; done: string }) {
  const qc = useQueryClient();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return useMutation({
    mutationFn: opts.run,
    onSuccess: () => {
      toast.success(opts.queued);
      timers.current.forEach(clearTimeout);
      timers.current = REFRESH_AFTER_MS.map((ms, i) => setTimeout(() => {
        void qc.invalidateQueries({ queryKey: opts.queryKey });
        if (i === REFRESH_AFTER_MS.length - 1) toast.success(opts.done);
      }, ms));
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
}

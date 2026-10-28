// frontend/app/(app)/objects/[object]/_processes.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, Skeleton, Stat, Status } from "@/design";
import { PROCESS_L1_MODULES, l1Readiness, readinessHref, redsByRule } from "@/components/process/shared";
import { getBusinessProcess } from "@/lib/api/connectivity";
import { plural } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

/** The L1 processes (PTP, OTC) whose fields come from `object`, in definition order; empty when it feeds none. */
export const processesOf = (object: string): string[] =>
  Object.entries(PROCESS_L1_MODULES).filter(([, modules]) => modules.includes(object)).map(([l1]) => l1);

/**
 * "Processes this object feeds": one tile per L1 the object's fields belong to, with its verdict and the steps its
 * failing fields block, read from the business-process readiness API (the same read Process data readiness makes).
 * Each tile opens that readiness page for this object and run. Hidden when the object feeds no process, or when the
 * run has no process document for it.
 */
export function ObjectProcesses({ object, run }: { object: string; run: string }) {
  const feeds = processesOf(object);
  const q = useQuery({
    queryKey: queryKeys.businessProcess(run, object),
    queryFn: () => getBusinessProcess(run, object),
    enabled: !!run && feeds.length > 0,
    retry: false,
    meta: { ignoreError: true },
  });
  if (feeds.length === 0 || !run) return null;
  if (q.isLoading) return <div aria-busy="true"><Skeleton height={84} /></div>;
  const rows = feeds
    .map((l1) => q.data?.find((p) => p.l1_id === l1))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ p, ready: l1Readiness(p, object), blocked: new Set(redsByRule(p).flatMap((r) => r.steps)).size }));
  if (rows.length === 0) return null;
  return (
    <Card title="Processes this object feeds" meta="The business processes that read this object's fields, and what blocks them in this run">
      <div className="m-stat-grid">
        {rows.map(({ p, ready, blocked }) => (
          <Stat
            key={p.l1_id}
            label={p.l1_name}
            value={<Status kind="verdict" value={ready.verdict} />}
            hint={blocked ? plural(blocked, "step blocked", "steps blocked") : "No steps blocked"}
            href={readinessHref({ l1: p.l1_id, object, run })}
          />
        ))}
      </div>
    </Card>
  );
}

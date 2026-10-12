"use client";

/**
 * Live operations for the Basis home: the health of every connected system,
 * when each was last extracted, and the jobs running right now. Ported from
 * the retired command centre, without the stewardship and findings panels,
 * which belong to the lead and steward homes.
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Button, Card, EmptyState, ErrorState, Pill, Skeleton, type PillTone } from "@/design";
import { useJobs } from "@/hooks/use-jobs";
import { useNowSec } from "@/hooks/use-now";
import { getSystems } from "@/lib/api/connectivity";
import { isListFailure } from "@/lib/error";
import { labelOf, relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

const HEALTH: Record<string, { tone: PillTone; label: string }> = {
  healthy: { tone: "go", label: "Healthy" },
  degraded: { tone: "at-risk", label: "Degraded" },
  unreachable: { tone: "no-go", label: "Unreachable" },
  auth_failed: { tone: "no-go", label: "Sign-in refused" },
  unknown: { tone: "neutral", label: "Not tested" },
};

const row = "flex items-center gap-3 border-t px-1 text-[13px]";
const rowStyle = { borderColor: "var(--m-line)", minHeight: 36 };
const meta = "ml-auto tabular-nums";
const metaStyle = { color: "var(--m-ink-3)" };

export function LiveSection() {
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const { active } = useJobs();
  const nowSec = useNowSec(active.length > 0, 5_000);
  const systems = systemsQ.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card title="Systems" padding="sm">
        {systemsQ.isLoading ? <Skeleton height={80} />
          : isListFailure(systemsQ) ? (
            <div className="p-3">
              <ErrorState message="Live system state could not be read." onRetry={() => void systemsQ.refetch()} />
            </div>
          ) : systems.length ? systems.map((s) => {
            const h = HEALTH[s.health_status ?? "unknown"] ?? HEALTH.unknown;
            return (
              <div key={s.id} className={row} style={rowStyle}>
                <Pill tone={s.is_active ? h.tone : "neutral"}>{s.is_active ? h.label : "Inactive"}</Pill>
                <span style={{ color: "var(--m-ink)" }}>{s.name}</span>
                <span className={meta} style={metaStyle}>
                  {s.last_sync_at ? `extracted ${relativeTime(s.last_sync_at)}` : "never extracted"}
                </span>
              </div>
            );
          }) : <div className="p-3"><EmptyState title="No systems connected yet." action={<Button variant="secondary" render={<Link href="/systems">Connect a system</Link>} />} /></div>}
      </Card>

      <Card title="Jobs running" padding="sm">
        {active.length ? active.map((j) => (
          <div key={j.id} className={row} style={rowStyle}>
            <Pill tone={j.status === "queued" ? "neutral" : "at-risk"}>{labelOf(j.status)}</Pill>
            <span style={{ color: "var(--m-ink)" }}>{j.label}</span>
            <span className={meta} style={metaStyle}>
              {j.percent}%, running {relativeTime(new Date(Math.min(j.started_at, nowSec) * 1000).toISOString())}
            </span>
          </div>
        )) : <div className="p-3"><EmptyState title="Nothing is running." action={<Button variant="secondary" render={<Link href="/systems">Run an extraction</Link>} />} /></div>}
      </Card>
    </div>
  );
}

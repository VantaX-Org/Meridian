// frontend/app/(app)/insights/owners/page.tsx
"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, Delta, Pill, Stat, type PillTone } from "@/design";
import { getOwners, getReadiness, type OwnerCardResponse } from "@/lib/api/insights";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { CardSkeleton, InsightFrame } from "../_components/InsightFrame";

/** No direct severity->PillTone mapping exists yet; critical/high read as blocking (no-go), medium as at-risk, low/other as neutral. */
function severityTone(severity: string): PillTone {
  if (severity === "critical" || severity === "high") return "no-go";
  if (severity === "medium") return "at-risk";
  return "neutral";
}

const openCount = (o: OwnerCardResponse) => Object.values(o.open_by_severity).reduce((a, b) => a + b, 0);

const scoreColumns: ColumnDef<OwnerCardResponse>[] = [
  { accessorKey: "owner", header: "Owner" },
  { accessorKey: "score", header: "Score", meta: { numeric: true, heat: "seq", heatRange: [0, 100] } },
  { id: "open", header: "Open items", accessorFn: openCount, meta: { numeric: true } },
  { accessorKey: "fixed_since_baseline", header: "Fixed since baseline", meta: { numeric: true } },
];

function OwnerCard({ owner }: { owner: OwnerCardResponse }) {
  return (
    <Card title={owner.owner} padding="md">
    <div data-testid="owner-card" className="flex flex-col gap-3">
      <Stat label="Score" value={owner.score} delta={<Delta value={owner.delta} />} href="/inbox" />
      <div className="flex gap-2 m-text-body">
        {Object.entries(owner.open_by_severity).map(([severity, count]) => (
          <Pill key={severity} tone={severityTone(severity)}>
            {severity}: {count}
          </Pill>
        ))}
      </div>
      <div className="m-text-body" style={{ color: "var(--m-ink-3)" }}>
        Fixed since baseline: {owner.fixed_since_baseline}, oldest open item: {owner.oldest_item_age_days}d
      </div>
      <p className="m-text-body">{owner.digest}</p>
      <div className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>
        {owner.schedule} digest, last sent {owner.last_sent ?? "never"}
      </div>
    </div>
    </Card>
  );
}

export default function OwnersPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.insights("owners"),
    queryFn: () => getOwners(),
  });

  const readiness = useQuery({ queryKey: queryKeys.insights("readiness", undefined), queryFn: () => getReadiness() });
  const owners = data?.owners ?? [];

  const threshold = readiness.data?.threshold;
  const below = typeof threshold === "number" ? owners.filter((o) => o.score < threshold).length : undefined;
  const openTotal = owners.reduce((n, o) => n + Object.values(o.open_by_severity).reduce((a, b) => a + b, 0), 0);
  const worst = [...owners].sort((x, y) => x.score - y.score)[0];

  return (
    <InsightFrame
      title="Owners"
      insight={{
        situation: { sentence: below === undefined ? "—" : `${below} of ${owners.length} owners are below the ${threshold}% threshold`, tone: below === undefined ? undefined : below ? "at-risk" : "go" },
        changed: { sentence: `${owners.filter((o) => o.delta < 0).length} owners lost ground this run` },
        why: { sentence: openTotal ? `${openTotal} open items sit with owners` : "—" },
        next: { sentence: worst ? `Start with ${worst.owner}` : "Assign owners", action: { label: "Open inbox", href: "/inbox" } },
      }}
      skeleton={<CardSkeleton height={220} />}
      state={isLoading ? "loading" : isListFailure({ isError, error }) ? "error" : owners.length === 0 ? "empty" : undefined}
      emptyProps={{
        title: "No owners scored yet",
        detail: "Owners appear after the first analysis.",
        ghost: "list",
        action: <Button render={<Link href="/inbox">Open inbox</Link>} />,
      }}
      errorProps={{ message: apiErrorMessage(error), onRetry: () => void refetch() }}
    >
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        {owners.map((owner) => (
          <OwnerCard key={owner.owner} owner={owner} />
        ))}
      </div>
      <Card title="Score by owner" dataTour="owners">
        <DataTable columns={scoreColumns} data={owners} getRowId={(o) => o.owner} hideToolbar dense height="auto" />
      </Card>
    </InsightFrame>
  );
}

// frontend/app/(app)/insights/owners/page.tsx
"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, Delta, ExplorerPage, Pill, Stat, type PillTone } from "@/design";
import { getOwners, type OwnerCardResponse } from "@/lib/api/insights";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

/** No direct severity->PillTone mapping exists yet; critical/high read as blocking (no-go), medium as at-risk, low/other as neutral. */
function severityTone(severity: string): PillTone {
  if (severity === "critical" || severity === "high") return "no-go";
  if (severity === "medium") return "at-risk";
  return "neutral";
}

function OwnerCard({ owner }: { owner: OwnerCardResponse }) {
  return (
    <div
      data-testid="owner-card"
      className="flex flex-col gap-3 p-4 rounded border"
      style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)" }}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold">{owner.owner}</span>
        <Stat label="Score" value={owner.score} delta={<Delta value={owner.delta} />} />
      </div>
      <div className="flex gap-2 text-[13px]">
        {Object.entries(owner.open_by_severity).map(([severity, count]) => (
          <Pill key={severity} tone={severityTone(severity)}>
            {severity}: {count}
          </Pill>
        ))}
      </div>
      <div className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
        Fixed since baseline: {owner.fixed_since_baseline}, oldest open item: {owner.oldest_item_age_days}d
      </div>
      <p className="text-[13px]">{owner.digest}</p>
      <div className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>
        {owner.schedule} digest, last sent {owner.last_sent ?? "never"}
      </div>
    </div>
  );
}

export default function OwnersPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.insights("owners"),
    queryFn: () => getOwners(),
  });

  const owners = data?.owners ?? [];

  return (
    <ExplorerPage
      table={
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          {owners.map((owner) => (
            <OwnerCard key={owner.owner} owner={owner} />
          ))}
        </div>
      }
      state={isLoading ? "loading" : isError ? "error" : owners.length === 0 ? "empty" : undefined}
      emptyProps={{
        title: "No owners scored yet.",
        action: <Button render={<Link href="/inbox">Open inbox</Link>} />,
      }}
      errorProps={{
        message: apiErrorMessage(error),
        onRetry: () => refetch(),
      }}
    />
  );
}

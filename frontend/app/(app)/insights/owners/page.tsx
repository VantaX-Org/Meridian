// frontend/app/(app)/insights/owners/page.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { Delta, ExplorerPage, Stat } from "@/design";
import { getOwners, type OwnerCardResponse } from "@/lib/api/insights";

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
      <div className="flex gap-3 text-[13px]">
        {Object.entries(owner.open_by_severity).map(([severity, count]) => (
          <span key={severity}>
            {severity}: {count}
          </span>
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
  const { data, isLoading, isError } = useQuery({
    queryKey: ["insights", "owners"],
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
      emptyProps={{ title: "No owner digests for this run yet." }}
      errorProps={{ message: "Couldn't load owner digests. Try again." }}
    />
  );
}

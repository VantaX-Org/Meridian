// frontend/app/(app)/insights/owners/page.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, Card, ConfirmDialog, DataTable, Delta, Stat, Status } from "@/design";
import { useRole } from "@/hooks/use-role";
import { getOwners, getReadiness, type OwnerCardResponse } from "@/lib/api/insights";
import { sendOwnerDigests } from "@/lib/api/owners";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { labelOf, plural, relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { CardSkeleton, InsightFrame } from "../_components/InsightFrame";
import { useInsightScope } from "../_components/useInsightScope";


const openCount = (o: OwnerCardResponse) => Object.values(o.open_by_severity).reduce((a, b) => a + b, 0);

const scoreColumns: ColumnDef<OwnerCardResponse>[] = [
  { accessorKey: "owner", header: "Owner" },
  { accessorKey: "score", header: "Score", meta: { numeric: true, heat: "seq", heatRange: [0, 100] } },
  { id: "open", header: "Open items", accessorFn: openCount, meta: { numeric: true } },
  { accessorKey: "fixed_since_baseline", header: "Fixed since baseline", meta: { numeric: true } },
];

/** Writes the digest notification now. `owner` undefined sends to everyone. */
function useSendDigests() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (owner?: string) => sendOwnerDigests(owner ? { owner } : {}),
    onSuccess: (r) => {
      toast.success(r.owner ? `Digest sent to ${r.owner}` : `Digest sent to ${r.sent} owner${r.sent === 1 ? "" : "s"}`);
      void qc.invalidateQueries({ queryKey: queryKeys.insights("owners") });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
}

function OwnerCard({ owner, canSend, send }: { owner: OwnerCardResponse; canSend: boolean; send: ReturnType<typeof useSendDigests> }) {
  return (
    <Card title={owner.owner} padding="md">
    <div data-testid="owner-card" className="flex flex-col gap-3">
      <Stat label="Score" value={owner.score} delta={<Delta value={owner.delta} />} href="/inbox" />
      <div className="flex gap-2 m-text-body">
        {Object.entries(owner.open_by_severity).map(([severity, count]) => (
          <Status key={severity} kind="severity" value={severity} count={count} />
        ))}
      </div>
      <div className="m-text-body m-ink-3">
        {`Fixed since baseline ${owner.fixed_since_baseline.toLocaleString()}, oldest open item ${plural(owner.oldest_item_age_days, "day")}`}
      </div>
      <p className="m-text-body">{owner.digest}</p>
      <div className="m-text-meta m-ink-3">
        {labelOf(owner.schedule)} digest, last sent {owner.last_sent ? relativeTime(owner.last_sent) : "never"}
      </div>
      {canSend ? (
        <div>
          <Button variant="secondary" size="sm" onClick={() => send.mutate(owner.owner)} pending={send.isPending && send.variables === owner.owner}>Send digest now</Button>
        </div>
      ) : null}
    </div>
    </Card>
  );
}

export default function OwnersPage() {
  const { can } = useRole();
  const { run } = useInsightScope();
  const canSend = can("manage_rules");
  const send = useSendDigests();
  const [confirmAll, setConfirmAll] = useState(false);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.insights("owners"),
    queryFn: () => getOwners(),
  });

  const readiness = useQuery({ queryKey: queryKeys.insights("readiness", run), queryFn: () => getReadiness({ version_id: run }) });
  const owners = data?.owners ?? [];

  const threshold = readiness.data?.threshold;
  const below = typeof threshold === "number" ? owners.filter((o) => o.score < threshold).length : undefined;
  const openTotal = owners.reduce((n, o) => n + Object.values(o.open_by_severity).reduce((a, b) => a + b, 0), 0);
  const worst = [...owners].sort((x, y) => x.score - y.score)[0];

  return (
    <InsightFrame
      title="Owners"
      run={run}
      controls={
        <>
          {canSend && owners.length > 0 ? <Button variant="secondary" onClick={() => setConfirmAll(true)}>Send digests to everyone</Button> : null}
          <Button variant="secondary" render={<Link href="/rules/scoring">Schedule digests</Link>} />
        </>
      }
      insight={{
        situation: { sentence: below === undefined ? "—" : `${below} of ${plural(owners.length, "owner is", "owners are")} below the ${threshold}% threshold`, tone: below === undefined ? undefined : below ? "at-risk" : "go" },
        changed: { sentence: `${plural(owners.filter((o) => o.delta < 0).length, "owner")} lost ground this run` },
        why: { sentence: openTotal ? `${plural(openTotal, "open item sits", "open items sit")} with owners` : "No open item sits with an owner" },
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
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
        {owners.map((owner) => (
          <OwnerCard key={owner.owner} owner={owner} canSend={canSend} send={send} />
        ))}
      </div>
      <Card title="Score by owner" dataTour="owners">
        <DataTable columns={scoreColumns} data={owners} getRowId={(o) => o.owner} hideToolbar dense height="auto" />
      </Card>
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Send digests to everyone"
        body={`Every owner with open items gets the weekly digest as a notification now. The weekly schedule is not changed.`}
        confirmLabel="Send digests"
        pending={send.isPending && send.variables === undefined}
        onConfirm={() => send.mutate(undefined, { onSettled: () => setConfirmAll(false) })}
      />
    </InsightFrame>
  );
}

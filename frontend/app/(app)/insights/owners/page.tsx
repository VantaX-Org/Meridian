// frontend/app/(app)/insights/owners/page.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { fixHref } from "@/lib/drill";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, Card, ConfirmDialog, DataTable, Delta, Status } from "@/design";
import { useRole } from "@/hooks/use-role";
import { getOwners, type OwnerCardResponse } from "@/lib/api/insights";
import { getObjects } from "@/lib/api/v1/objects";
import { sendOwnerDigests } from "@/lib/api/owners";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { labelOf, plural, relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { CardSkeleton, InsightFrame } from "../_components/InsightFrame";
import { useInsightScope } from "../_components/useInsightScope";
import { PAGE_PURPOSE } from "../_components/InsightViews";


const openCount = (o: OwnerCardResponse) => Object.values(o.open_by_severity).reduce((a, b) => a + b, 0);

const scoreColumns: ColumnDef<OwnerCardResponse>[] = [
  { accessorKey: "owner", header: "Owner" },
  { accessorKey: "score", header: "Score", meta: { numeric: true, heat: "seq", heatRange: [0, 100] } },
  { id: "open", header: "Open items", accessorFn: openCount, meta: { numeric: true }, cell: ({ row }) => row.original.user_id
    ? <Link href={fixHref({ assignee: row.original.user_id })} aria-label={`Open the ${openCount(row.original).toLocaleString()} open records of ${row.original.owner}`} className="m-ink-accent underline underline-offset-2">{openCount(row.original).toLocaleString()}</Link>
    : openCount(row.original).toLocaleString() },
  { accessorKey: "delta", header: "Change", meta: { numeric: true }, cell: ({ row }) => <Delta value={row.original.delta} /> },
  { accessorKey: "fixed_since_baseline", header: "Fixed since the first run", meta: { numeric: true } },
  // The owner's own inbox tasks (the inbox reads ?assignee= as a user id, a name or an email); no link without a user.
  { id: "action", header: "", enableSorting: false, cell: ({ row }) => row.original.user_id
    ? <Link href={`/inbox?assignee=${encodeURIComponent(row.original.user_id)}`} aria-label={`Open the inbox of ${row.original.owner}`} className="m-ink-accent underline underline-offset-2">Open inbox</Link>
    : null },
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
      <div className="flex gap-2 m-text-body">
        {Object.entries(owner.open_by_severity).map(([severity, count]) => (
          <Status key={severity} kind="severity" value={severity} count={count} />
        ))}
      </div>
      <div className="m-text-body m-ink-3">
        {`${owner.fixed_since_baseline.toLocaleString()} fixed since the first run, oldest open item ${plural(owner.oldest_item_age_days, "day")} old`}
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

  // The tenant's score target (the objects list's bands), the same line the homes draw.
  const bandsQ = useQuery({ queryKey: queryKeys.objects("latest"), queryFn: () => getObjects("latest") });
  const owners = data?.owners ?? [];

  const target = bandsQ.data?.thresholds?.target;
  const below = typeof target === "number" ? owners.filter((o) => o.score < target).length : undefined;
  const openTotal = owners.reduce((n, o) => n + Object.values(o.open_by_severity).reduce((a, b) => a + b, 0), 0);
  const ranked = [...owners].sort((x, y) => x.score - y.score);
  const worst = ranked[0];

  return (
    <InsightFrame
      title="Owners"
      purpose={PAGE_PURPOSE["/insights/owners"]}
      run={run}
      controls={<Button variant="ghost" render={<Link href="/rules/scoring">Schedule digests</Link>} />}
      insight={{
        situation: { sentence: below === undefined ? `${plural(owners.length, "owner")} with open items` : `${below} of ${plural(owners.length, "owner is", "owners are")} below the target of ${target}`, tone: below === undefined ? undefined : below ? "at-risk" : "go" },
        changed: { sentence: `${plural(owners.filter((o) => o.delta < 0).length, "owner")} lost ground since the last run` },
        why: { sentence: openTotal ? `${plural(openTotal, "open item sits", "open items sit")} with owners` : "No open item sits with an owner" },
        next: canSend && owners.length
          ? { sentence: worst ? `Start with ${worst.owner}, the lowest score, and send everyone their digest` : "Send everyone their digest", action: { label: "Send digests to everyone", onClick: () => setConfirmAll(true) } }
          : { sentence: worst ? `Start with ${worst.owner}, the lowest score` : "Assign owners", action: { label: "Open inbox", href: "/inbox" } },
      }}
      skeleton={<CardSkeleton height={220} />}
      state={isLoading ? "loading" : isListFailure({ isError, error }) ? "error" : owners.length === 0 ? "empty" : undefined}
      emptyProps={{
        title: "No issues are assigned yet",
        detail: "Owners are scored on the records assigned to them, so they appear once records in Fix work have an owner.",
        ghost: "list",
        action: <Button render={<Link href="/fix">Open Fix work</Link>} />,
      }}
      errorProps={{ error: error, onRetry: () => void refetch() }}
    >
      <Card title="Score by owner" meta="Lowest score first" dataTour="owners">
        <DataTable columns={scoreColumns} data={ranked} getRowId={(o) => o.owner} hideToolbar dense height="auto" />
      </Card>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
        {ranked.map((owner) => (
          <OwnerCard key={owner.owner} owner={owner} canSend={canSend} send={send} />
        ))}
      </div>
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

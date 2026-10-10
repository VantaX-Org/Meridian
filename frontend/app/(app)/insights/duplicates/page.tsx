// frontend/app/(app)/insights/duplicates/page.tsx
"use client";

import { toast } from "sonner";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  ExplorerPage,
  Field,
  Graph,
  Select,
  type GraphNode,
} from "@/design";
import { createMergeProposals, getDuplicateCluster } from "@/lib/api/insights";
import { getMergeExplanation } from "@/lib/api/merge-explain";
import { getObjects } from "@/lib/api/v1/objects";
import { queryKeys } from "@/lib/query-keys";

export default function DuplicatesPage() {
  const search = useSearchParams();
  const router = useRouter();
  const run = search.get("run") ?? "";

  const objects = useQuery({
    queryKey: queryKeys.objects(run),
    queryFn: () => getObjects(run),
    enabled: !!run,
  });

  const [object, setObject] = useState("");
  const [recordId, setRecordId] = useState("");
  const [masterId, setMasterId] = useState<string | null>(null);

  const cluster = useQuery({
    queryKey: queryKeys.insights("duplicates", object && recordId ? `${object}/${recordId}` : undefined),
    queryFn: () => getDuplicateCluster(object, recordId),
    enabled: !!object && !!recordId,
  });

  const nodes = useMemo(() => cluster.data?.nodes ?? [], [cluster.data]);

  // The underlying match_score_id for each pair is carried in `label` by the
  // cluster endpoint (see insights.ts's DuplicateClusterResponse); copy it
  // into `id` here so the graph's dedicated id field, not a re-purposed
  // display label, is what the merge-proposal payload reads.
  const edges = useMemo(
    () => (cluster.data?.edges ?? []).map((e) => ({ ...e, id: e.label })),
    [cluster.data],
  );

  // The cluster endpoint carries only record-level nodes/edges (no per-field
  // diff), so "pick from master" is one radio per candidate record, not per
  // field — the closest honest read of the brief given this response shape.
  const edgesTouchingMaster = useMemo(
    () => (masterId ? edges.filter((e) => e.source === masterId || e.target === masterId) : []),
    [edges, masterId],
  );

  const pairs = useMemo(
    () => edgesTouchingMaster.filter((e) => e.id).map((e) => ({ match_score_id: e.id as string, priority: 1 })),
    [edgesTouchingMaster],
  );

  // "Documents that would move": the explain endpoint's member list for the
  // chosen master, minus the master itself.
  const explain = useQuery({
    queryKey: queryKeys.mergeExplain(masterId ?? ""),
    queryFn: () => getMergeExplanation(masterId as string),
    enabled: !!masterId,
  });
  const mergeImpactCount = explain.data ? Math.max(explain.data.members.length - 1, 0) : 0;

  const canPropose = masterId !== null && pairs.length > 0;

  async function handleCreateMergeProposals() {
    if (pairs.length === 0) return;
    const result = await createMergeProposals(pairs);
    toast(`Created ${result.created.length} merge proposal${result.created.length === 1 ? "" : "s"}`, {
      action: { label: "Review in stewardship", onClick: () => router.push("/workbench?tab=queue") },
    });
  }

  const state: "loading" | "empty" | "error" | undefined =
    !object || !recordId ? "empty" : cluster.isLoading ? "loading" : cluster.isError ? "error" : nodes.length === 0 ? "empty" : undefined;

  return (
    <ExplorerPage
      filterBar={
        <div className="flex gap-3 items-end">
          <Field label="Object">
            <Select
              value={object}
              onValueChange={(v) => {
                setObject(v);
                setMasterId(null);
              }}
              options={(objects.data?.objects ?? []).map((o) => ({ value: o.module, label: o.label }))}
              placeholder="Choose an object"
            />
          </Field>
          <Field label="Record ID">
            <input
              aria-label="Record ID"
              value={recordId}
              onChange={(e) => {
                setRecordId(e.target.value);
                setMasterId(null);
              }}
              className="rounded border px-3 py-1.5 text-[13px]"
              style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)", color: "var(--m-ink)" }}
            />
          </Field>
        </div>
      }
      table={
        <div className="flex flex-col gap-4">
          <Graph nodes={nodes} edges={edges} onNodeClick={(id) => setMasterId(id)} />
          <ClusterPanel nodes={nodes} masterId={masterId} onPick={setMasterId} mergeImpactCount={mergeImpactCount} />
          <Button onClick={handleCreateMergeProposals} disabled={!canPropose}>
            Create merge proposal
          </Button>
        </div>
      }
      state={state}
      emptyProps={{ title: !object || !recordId ? "Pick an object and a record to see its duplicate cluster." : "No duplicate cluster found for this record." }}
      errorProps={{
        message: cluster.error instanceof Error ? cluster.error.message : "Couldn't load the duplicate cluster. Try again.",
        onRetry: () => cluster.refetch(),
      }}
    />
  );
}

function ClusterPanel({
  nodes,
  masterId,
  onPick,
  mergeImpactCount,
}: {
  nodes: GraphNode[];
  masterId: string | null;
  onPick: (id: string) => void;
  mergeImpactCount: number;
}) {
  return (
    <fieldset className="flex flex-col gap-2 p-3 rounded border" style={{ borderColor: "var(--m-line)" }}>
      <legend className="text-[12px]" style={{ color: "var(--m-ink-2)" }}>
        Pick the surviving (master) record
      </legend>
      {nodes.map((node) => (
        <label key={node.id} className="flex items-center gap-2 text-[13px]">
          <input
            type="radio"
            name="master"
            value={node.id}
            checked={masterId === node.id}
            onChange={() => onPick(node.id)}
          />
          {node.label ?? node.id}
        </label>
      ))}
      <p className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>
        Merge impact: {mergeImpactCount} document{mergeImpactCount === 1 ? "" : "s"} would move.
      </p>
    </fieldset>
  );
}

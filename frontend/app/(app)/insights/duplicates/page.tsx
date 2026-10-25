// frontend/app/(app)/insights/duplicates/page.tsx
"use client";

import { toast } from "sonner";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Graph,
  Input,
  Select,
  Tabs,
  type GraphNode,
} from "@/design";
import { createMergeProposals, getDuplicateCluster } from "@/lib/api/insights";
import { getMiningDuplicates } from "@/lib/api/mining";
import { previousInLineage } from "@/lib/runs";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { plural } from "@/lib/format";
import { Skeleton } from "@/design";
import { getMergeExplanation } from "@/lib/api/merge-explain";
import { getObjects } from "@/lib/api/v1/objects";
import { queryKeys } from "@/lib/query-keys";
import { CardSkeleton, InsightFrame } from "../_components/InsightFrame";
import { useInsightScope } from "../_components/useInsightScope";
import { PAGE_PURPOSE } from "../_components/InsightViews";
import { MinedAnomalies, MinedDuplicates, MinedRelationships } from "./mined-tabs";

export default function DuplicatesPage() {
  const search = useSearchParams();
  const router = useRouter();
  const scope = useInsightScope();
  const run = scope.run ?? "";
  // What changed: pairs mined in this run against the run before it in its lineage (same key as the Mined pairs tab).
  const current = scope.runs.find((r) => r.id === run);
  const previous = current ? previousInLineage(current, scope.runs) : null;
  const minedNow = useQuery({ queryKey: ["mining", "duplicates", run], queryFn: () => getMiningDuplicates({ version_id: run || undefined, limit: 500 }), enabled: !!run && !!previous });
  const minedBefore = useQuery({ queryKey: ["mining", "duplicates", previous?.id ?? ""], queryFn: () => getMiningDuplicates({ version_id: previous?.id, limit: 500 }), enabled: !!previous });
  const pairsNow = minedNow.data?.length ?? 0;
  const pairsBefore = minedBefore.data?.length ?? 0;
  const changed = !run || !current
    ? "First run of this system"
    : !previous
      ? "First run of this system"
      : minedNow.isLoading || minedBefore.isLoading
        ? <Skeleton height={16} />
        : !minedNow.data || !minedBefore.data
          ? "The previous run could not be read"
          : pairsNow === pairsBefore
            ? `${plural(pairsNow, "duplicate pair")} mined, as in the previous run`
            : `${Math.abs(pairsNow - pairsBefore).toLocaleString()} ${pairsNow > pairsBefore ? "more" : "fewer"} duplicate pairs mined than in the previous run`;
  const tab = search.get("tab") ?? "clusters";
  const setTab = (next: string) => {
    const params = new URLSearchParams(search.toString());
    if (next === "clusters") params.delete("tab"); else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "?");
  };

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

  // Cluster index = connected component over the matched pairs, so unlinked records get their own colour.
  const nodes = useMemo(() => {
    const raw = cluster.data?.nodes ?? [];
    const parent = new Map(raw.map((n) => [n.id, n.id]));
    const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x) ?? x));
    for (const e of cluster.data?.edges ?? []) if (parent.has(e.source) && parent.has(e.target)) parent.set(find(e.source), find(e.target));
    const index = new Map<string, number>();
    return raw.map((n) => {
      const root = find(n.id);
      if (!index.has(root)) index.set(root, index.size);
      return { ...n, cluster: index.get(root) };
    });
  }, [cluster.data]);

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

  const [proposing, setProposing] = useState(false);
  async function handleCreateMergeProposals() {
    if (pairs.length === 0) return;
    setProposing(true);
    try {
      const result = await createMergeProposals(pairs);
      toast(`Created ${result.created.length} merge proposal${result.created.length === 1 ? "" : "s"}`, {
        action: { label: "Review in the inbox", onClick: () => router.push("/inbox") },
      });
    } catch (e) {
      // A failed proposal says so; it never fails silently as an unhandled rejection.
      toast.error(apiErrorMessage(e));
    } finally {
      setProposing(false);
    }
  }

  const state: "loading" | "empty" | "error" | undefined =
    objects.isLoading ? "loading" : !object || !recordId ? "empty" : cluster.isLoading ? "loading" : cluster.isError ? "error" : nodes.length === 0 ? "empty" : undefined;

  const picked = !!object && !!recordId;
  return (
    <InsightFrame
      title="Duplicates"
      purpose={PAGE_PURPOSE["/insights/duplicates"]}
      scope
      run={run || undefined}
      insight={{
        situation: { sentence: !picked ? "Pick a record to see its cluster" : cluster.isLoading ? "Reading the cluster" : `${plural(nodes.length, "record is", "records are")} in this cluster` },
        changed: { sentence: changed, href: previous && run ? `/runs/${run}/vs/${previous.id}` : undefined },
        why: { sentence: picked && !cluster.isLoading ? `${plural(edges.length, "matched pair links", "matched pairs link")} these records` : "A cluster shows which records would merge into one" },
        next: nodes.length
          ? { sentence: "Choose the record to keep, then propose the merge" }
          : { sentence: "Not sure which record to check? Start from the likely duplicate pairs", action: { label: "Open likely duplicates", onClick: () => setTab("pairs") } },
        loading: picked && cluster.isLoading,
      }}
    >
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          { value: "clusters", label: "Clusters", content: (
            <div className="flex flex-col gap-4">
      <Card title="Find a record's duplicates" meta="Choose the object, then enter the record's key, for example a material or vendor number">
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
          <Field label="Record key">
            <Input
              aria-label="Record key"
              value={recordId}
              onChange={(e) => {
                setRecordId(e.target.value);
                setMasterId(null);
              }}
            />
          </Field>
        </div>
      </Card>
      {!run && !scope.resolving ? (
        <EmptyState title="No finished run yet" detail="Duplicates are found in the records of a finished run." ghost="grid" action={<Button render={<Link href="/runs">Open runs</Link>}/>} />
      ) : objects.isError ? (
        <ErrorState {...apiErrorState(objects.error)} onRetry={() => void objects.refetch()} />
      ) : state === "loading" ? (
        <div aria-busy="true"><CardSkeleton height={320} /></div>
      ) : state === "error" ? (
        <ErrorState {...apiErrorState(cluster.error)} onRetry={() => void cluster.refetch()} />
      ) : state === "empty" ? (
        picked ? (
          <EmptyState title="No duplicates for this record" detail="No other record matches it under the current match rules. Check the key, or loosen the match rules." ghost="grid" action={<Button variant="secondary" render={<Link href="/mdm/match-rules">Open match rules</Link>} />} />
        ) : (
          <EmptyState title="Choose an object and a record" detail="Its duplicates show here as a cluster. To browse candidates instead, open the likely duplicate pairs." ghost="grid" action={<Button variant="secondary" onClick={() => setTab("pairs")}>Open likely duplicates</Button>} />
        )
      ) : (
        <Card title="Duplicate cluster" meta="Each dot is a record; a line means two records match. Select the record to keep.">
          <div className="flex flex-col gap-4">
            <Graph nodes={nodes} edges={edges} onNodeClick={(id) => setMasterId(id)} />
            <ClusterPanel nodes={nodes} masterId={masterId} onPick={setMasterId} mergeImpactCount={mergeImpactCount} />
            <div>
              <Button onClick={() => void handleCreateMergeProposals()} disabled={!canPropose} pending={proposing}>
                Create merge proposal
              </Button>
              {!masterId ? <p className="mt-1 m-text-meta m-ink-3">Choose the record to keep first</p> : null}
            </div>
          </div>
        </Card>
      )}
            </div>
          ) },
          { value: "pairs", label: "Likely duplicates", content: <MinedDuplicates run={run} /> },
          { value: "anomalies", label: "Anomalies", content: <MinedAnomalies run={run} /> },
          { value: "relationships", label: "Relationships", content: <MinedRelationships run={run} /> },
        ]}
      />
    </InsightFrame>
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
    <fieldset className="flex flex-col gap-2 p-3 rounded border [border-color:var(--m-line)]">
      <legend className="m-text-meta m-ink-2">
        Choose the record to keep (the master)
      </legend>
      {nodes.map((node) => (
        <label key={node.id} className="flex items-center gap-2 m-text-body">
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
      <p className="m-text-meta m-ink-3">
        {plural(mergeImpactCount, "linked document")} would move to it
      </p>
    </fieldset>
  );
}

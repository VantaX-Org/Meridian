// frontend/app/(app)/insights/duplicates/page.tsx
"use client";

import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
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
  type GraphNode,
} from "@/design";
import { createMergeProposals, getDuplicateCluster } from "@/lib/api/insights";
import { getMiningDuplicates } from "@/lib/api/mining";
import { previousInLineage } from "@/lib/runs";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { formatModuleName, plural } from "@/lib/format";
import { Skeleton } from "@/design";
import { getMergeExplanation } from "@/lib/api/merge-explain";
import { getObjects } from "@/lib/api/v1/objects";
import { queryKeys } from "@/lib/query-keys";
import { CardSkeleton, InsightFrame } from "../_components/InsightFrame";
import { useInsightScope } from "../_components/useInsightScope";
import { useCurrentState } from "../_components/useCurrentState";
import { PAGE_PURPOSE } from "../_components/InsightViews";
import { MinedAnomalies, MinedDuplicates, MinedRelationships, useMinedFeeds } from "./mined-tabs";

export default function DuplicatesPage() {
  const search = useSearchParams();
  const router = useRouter();
  const scope = useInsightScope();
  // Without ?run= (or ?module=) the page reads the current state: every object at its own latest run, as Home does.
  const isCurrent = scope.mode === "current";
  const state = useCurrentState();
  const run = isCurrent ? "" : scope.run ?? "";
  const feeds = useMinedFeeds({ run, current: isCurrent });
  // What changed: pairs mined in this run against the run before it in its lineage (same key as the Mined pairs tab).
  const current = scope.runs.find((r) => r.id === run);
  const previous = current ? previousInLineage(current, scope.runs) : null;
  const minedNow = feeds.duplicates;
  const minedBefore = useQuery({ queryKey: ["mining", "duplicates", previous?.id ?? ""], queryFn: () => getMiningDuplicates({ version_id: previous?.id, limit: 500 }), enabled: !!previous });
  const pairsNow = minedNow.data?.length ?? 0;
  const pairsBefore = minedBefore.data?.length ?? 0;
  const changed = isCurrent
    ? minedNow.isLoading ? <Skeleton height={16} /> : `${plural(pairsNow, "likely duplicate pair")} mined across ${plural(state.objects.length, "object")}, each from its own latest run`
    : !run || !current
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
  // The page is one flow (cluster, likely duplicates, anomalies, relationships); an old `?tab=` link scrolls to its part.
  const tab = search.get("tab");
  useEffect(() => {
    if (tab && tab !== "clusters") document.getElementById(`duplicates-${tab}`)?.scrollIntoView?.({ block: "start" });
  }, [tab]);

  const objects = useQuery({
    queryKey: queryKeys.objects(run),
    queryFn: () => getObjects(run),
    enabled: !!run,
  });
  // The objects a record can be looked up in: the current state's, or the shown run's.
  const objectOptions = isCurrent
    ? state.objects.map((o) => ({ value: o.module, label: formatModuleName(o.module) }))
    : (objects.data?.objects ?? []).map((o) => ({ value: o.module, label: o.label }));

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

  const clusterState: "loading" | "empty" | "error" | undefined =
    (isCurrent ? state.loading : objects.isLoading) ? "loading" : !object || !recordId ? "empty" : cluster.isLoading ? "loading" : cluster.isError ? "error" : nodes.length === 0 ? "empty" : undefined;

  const picked = !!object && !!recordId;
  const noRun = isCurrent ? !state.loading && !state.objects.length : !run && !scope.resolving;
  // Nothing picked and nothing mined: one empty state for the page, not one per section.
  const nothing = !picked && feeds.allEmpty;
  return (
    <InsightFrame
      title="Duplicates"
      purpose={PAGE_PURPOSE["/insights/duplicates"]}
      scope
      run={isCurrent ? undefined : run || undefined}
      insight={{
        situation: { sentence: !picked ? "Pick a record to see its cluster" : cluster.isLoading ? "Reading the cluster" : `${plural(nodes.length, "record is", "records are")} in this cluster` },
        changed: { sentence: changed, href: previous && run ? `/runs/${run}/vs/${previous.id}` : undefined },
        why: { sentence: picked && !cluster.isLoading ? `${plural(edges.length, "matched pair links", "matched pairs link")} these records` : "A cluster shows which records would merge into one" },
        next: nodes.length
          ? { sentence: "Choose the record to keep, then propose the merge" }
          : { sentence: "Not sure which record to check? Review the scored pairs in Match review", action: { label: "Open match review", href: "/mdm/golden/merge" } },
        loading: picked && cluster.isLoading,
      }}
    >
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
              options={objectOptions}
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
      {noRun ? (
        <EmptyState title="No finished run yet" detail="Duplicates are found in the records of a finished run." ghost="grid" action={<Button render={<Link href="/runs">Open runs</Link>}/>} />
      ) : nothing ? (
        <EmptyState
          title={isCurrent ? "Nothing mined yet" : "Nothing mined in this run yet"}
          detail="Look up a record above to see its duplicates. Likely duplicate pairs, anomalies and field relationships show here once a run is mined; to decide on scored pairs instead, open Match review."
          ghost="grid"
          action={<Button variant="secondary" render={<Link href="/mdm/golden/merge">Open match review</Link>} />}
        />
      ) : !isCurrent && objects.isError ? (
        <ErrorState {...apiErrorState(objects.error)} onRetry={() => void objects.refetch()} />
      ) : clusterState === "loading" ? (
        picked ? <div aria-busy="true"><CardSkeleton height={320} /></div> : null
      ) : clusterState === "error" ? (
        <ErrorState {...apiErrorState(cluster.error)} onRetry={() => void cluster.refetch()} />
      ) : clusterState === "empty" ? (
        // Before a record is picked the lookup card says what to do; only a picked record without matches needs a state.
        picked ? (
          <EmptyState title="No duplicates for this record" detail="No other record matches it under the current match rules. Check the key, or loosen the match rules." ghost="grid" action={<Button variant="secondary" render={<Link href="/mdm/match-rules">Open match rules</Link>} />} />
        ) : null
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
      {nothing || noRun ? null : (
        <>
        <section id="duplicates-pairs" aria-label="Likely duplicates" className="flex flex-col gap-2">
          <h2 className="m-text-h font-semibold m-ink">Likely duplicates</h2>
          <p className="m-text-meta m-ink-3">{isCurrent ? "Pairs the miner found in each object's latest run." : "Pairs the miner found in this run."} Review takes a pair to Match review, where every merge is decided.</p>
          <MinedDuplicates q={feeds.duplicates} scope={{ run, current: isCurrent }} />
        </section>
        <section id="duplicates-anomalies" aria-label="Anomalies" className="flex flex-col gap-2">
          <h2 className="m-text-h font-semibold m-ink">Anomalies</h2>
          <MinedAnomalies q={feeds.anomalies} scope={{ run, current: isCurrent }} />
        </section>
        <section id="duplicates-relationships" aria-label="Relationships" className="flex flex-col gap-2">
          <h2 className="m-text-h font-semibold m-ink">Relationships</h2>
          <MinedRelationships q={feeds.relationships} scope={{ run, current: isCurrent }} />
        </section>
        </>
      )}
      </div>
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

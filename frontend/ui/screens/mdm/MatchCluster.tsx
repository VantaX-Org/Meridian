"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getClusterGraph } from "@/lib/api/v2/mdm-extra";
import type { ClusterEdge } from "@/lib/api/merge-explain";
import { describeField } from "@/lib/v2/sap-fields";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { Button, Card, DataTable, EmptyState, ErrorState, FieldChip, Graph, PageHeader, SeverityPill, Skeleton, StatTile, useAletheia, useAletheiaScope } from "@/ui/kit";
import { pct, useHref } from "./shared";

/** Cluster graph: members on a circle, one line per scored pair, on the shared kit Graph. */
function ClusterGraph({ nodes, edges, onPick, picked }: { nodes: { key: string; is_survivor: boolean }[]; edges: ClusterEdge[]; onPick: (e: ClusterEdge) => void; picked: string | null }) {
  return (
    <Graph
      layout="circle"
      label={t("Cluster graph")}
      nodes={nodes.map((n) => ({ id: n.key, label: n.key, emphasis: n.is_survivor }))}
      edges={edges.map((e, i) => ({
        id: String(i), source: e.source, target: e.target,
        label: e.total === null ? undefined : pct(e.total),
        tone: e.constraint === "do_not_match" ? "bad" : e.linked ? "good" : undefined,
        dashed: !e.linked, active: picked === `${e.source}|${e.target}`,
      }))}
      onPick={(ge) => onPick(edges[Number(ge.id)])}
    />
  );
}

export function MatchCluster({ id }: { id: string }) {
  useInterfaceLang();
  const href = useHref();
  const fx = useFixture();
  const chat = useAletheia();
  const [pick, setPick] = useState<ClusterEdge | null>(null);
  const q = useQuery({ queryKey: ["v2", "mdm", "cluster", fx, id], queryFn: () => getClusterGraph(id), staleTime: 30_000, retry: false });
  const g = q.data;

  useAletheiaScope({
    key: `mdm-cluster/${id}`,
    label: t("Asking about cluster {id}", { id }),
    suggestions: [t("Why are these records in one cluster?"), t("Which link is weakest?")],
    answer: () => ({
      text: g ? t("{n} records, {e} scored pairs and {w} weak chains.", { n: g.nodes.length, e: g.edges.length, w: g.weak_chains.length }) : t("The cluster has not loaded yet."),
      evidence: (g?.weak_chains ?? []).slice(0, 3).map((w) => `${w.a} - ${w.via} - ${w.b}`),
    }),
  });

  const reason = (r: string) => (r === "no_direct_score" ? t("No direct score") : r === "do_not_match" ? t("A steward said do not match") : t("Direct score below the threshold"));
  const shown = pick ?? null;

  return (
    <>
      <PageHeader
        title={t("Match cluster")}
        context={id}
        actions={<>
          <Button variant="ghost" href={href(`/mdm/golden/${id}`)}>{t("Golden record")}</Button>
          <Button variant="ghost" href={href("/mdm/match")}>{t("Match review")}</Button>
          <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
        </>}
      />
      {q.isLoading ? <Skeleton lines={8} label={t("Loading cluster")} /> : q.isError || !g ? <ErrorState heading={t("The cluster could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} /> : g.nodes.length === 0 ? <EmptyState heading={t("This record has no cluster")} body={t("Run matching to place this record in a cluster.")} /> : (
        <div className="mx-col">
          <dl className="mx-tiles">
            <StatTile label={t("Records")} value={String(g.nodes.length)} />
            <StatTile label={t("Scored pairs")} value={String(g.edges.length)} />
            <StatTile label={t("Weak chains")} value={String(g.weak_chains.length)} />
            <StatTile label={t("Auto-merge from")} value={pct(g.auto_merge)} />
          </dl>
          <Card title={t("Cluster graph")} sub={t("Solid green lines are linked pairs. Dashed lines are scored but not linked. Red lines are do-not-match.")}>
            <ClusterGraph nodes={g.nodes} edges={g.edges} picked={shown ? `${shown.source}|${shown.target}` : null} onPick={setPick} />
          </Card>
          <Card title={t("Scored pairs")} sub={t("Select a pair to see its field scores.")}>
            <DataTable<ClusterEdge>
              label={t("Scored pairs")}
              rows={g.edges}
              rowKey={(e) => `${e.source}|${e.target}`}
              selected={shown ? `${shown.source}|${shown.target}` : undefined}
              onSelect={setPick}
              columns={[
                { key: "a", label: t("Record A"), render: (e) => <FieldChip code={e.source} /> },
                { key: "b", label: t("Record B"), render: (e) => <FieldChip code={e.target} /> },
                { key: "s", label: t("Score"), align: "end", sort: (e) => e.total ?? 0, render: (e) => (e.total === null ? t("n/a") : pct(e.total)) },
                { key: "l", label: t("State"), render: (e) => <SeverityPill sev={e.constraint === "do_not_match" ? "critical" : e.linked ? "low" : "info"} label={e.constraint === "do_not_match" ? t("Do not match") : e.linked ? t("Linked") : t("Not linked")} /> },
                { key: "d", label: t("Steward"), render: (e) => (e.steward_decision === "accept" ? t("Accepted") : e.steward_decision === "reject" ? t("Rejected") : "") },
              ]}
            />
          </Card>
          {shown && (
            <Card title={t("Why {a} and {b} scored as they did", { a: shown.source, b: shown.target })}>
              {shown.explanation ? (
                <DataTable
                  label={t("Score by field")}
                  rows={shown.explanation.attributes}
                  rowKey={(x) => x.field}
                  columns={[
                    { key: "f", label: t("Field"), render: (x) => <FieldChip code={x.field} description={describeField(x.field) ?? undefined} /> },
                    { key: "a", label: t("Value A"), render: (x) => x.value_a },
                    { key: "b", label: t("Value B"), render: (x) => x.value_b },
                    { key: "sim", label: t("Similarity"), align: "end", render: (x) => (x.similarity === null ? t("n/a") : pct(x.similarity)) },
                    { key: "w", label: t("Weight"), align: "end", render: (x) => x.weight },
                  ]}
                />
              ) : <EmptyState heading={t("No explanation stored for this pair")} body={t("Run matching again to store why these two records match.")} />}
            </Card>
          )}
          <Card title={t("Weak chains")} sub={t("Two records joined only through a third one.")}>
            {g.weak_chains.length === 0 ? <EmptyState heading={t("No weak chains")} body={t("Every pair in the cluster is directly supported.")} /> : (
              <DataTable
                label={t("Weak chains")}
                rows={g.weak_chains.map((w, i) => ({ ...w, i }))}
                rowKey={(w) => String(w.i)}
                columns={[
                  { key: "a", label: t("Record A"), render: (w) => <FieldChip code={w.a} /> },
                  { key: "v", label: t("Through"), render: (w) => <FieldChip code={w.via} /> },
                  { key: "b", label: t("Record B"), render: (w) => <FieldChip code={w.b} /> },
                  { key: "r", label: t("Why weak"), render: (w) => reason(w.reason) },
                ]}
              />
            )}
          </Card>
        </div>
      )}
    </>
  );
}

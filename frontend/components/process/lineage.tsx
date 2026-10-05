"use client";

/**
 * Process → Lineage: SAP field to config, process step, SAP feature and
 * business KPI, drawn on the aurora ProcessGraph. Trace any node; the table
 * ranks the KPIs, processes and features the latest version's failing rules
 * reach. Selecting a node (?node=) opens its guarding rules or blast radius.
 */

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Banner, Button, DataTable, DetailDrawer, EmptyState, Input, Mono, PageHeader, SectionCard, Select, StatusBadge, TableSkeleton, Tally,
  useDrawerParam, type AuroraColumnMeta, type Status,
} from "@/components/ui-core";
import { ProcessGraph, ProcessGraphEmergence, type ProcessGraphProps } from "@/components/aurora";
import { useLatestVersion } from "@/components/process/shared";
import {
  getBlastRadius, getLineage, getLineageGuards, getLineageImpact, getLineageModel,
  type ImpactRow, type LineageDirection, type LineageNodeType, type Severity,
} from "@/lib/api/lineage";

const meta = (m: AuroraColumnMeta) => m;
const pct = (v: number | null | undefined) => (v == null ? "" : `${(v * 100).toFixed(1)}%`);
// ponytail: dagre lays out every node; past this the canvas is unreadable. Narrow the depth to see the rest.
const MAX_NODES = 150;

const KIND: Record<LineageNodeType, ProcessGraphProps["nodes"][number]["data"]["kind"]> = {
  config: "source", table: "source", field: "source", check: "decision", object: "transform", step: "transform",
  process: "approval", feature: "sink", kpi: "sink",
};
const SEV: Record<Severity, Status> = { critical: "critical", high: "high", medium: "medium", low: "low" };
const TYPE_LABEL: Record<ImpactRow["type"], string> = { kpi: "KPI", process: "Process", feature: "Feature" };

function GuardsPanel({ node, versionId }: { node: string; versionId?: string }) {
  const q = useQuery({ queryKey: ["lineage.guards", node, versionId], queryFn: () => getLineageGuards({ node, version_id: versionId }) });
  if (q.isLoading) return <TableSkeleton rows={3} label="Loading guards" />;
  if (q.error || !q.data) return <Banner tone="danger" title="Guards could not be read" />;
  const d = q.data;
  return (
    <>
      <p className="ui-note">
        {d.steps.length.toLocaleString()} {d.steps.length === 1 ? "step feeds" : "steps feed"} this node.{" "}
        {d.coverage_gaps.length ? `${d.coverage_gaps.length.toLocaleString()} have no guarding rule.` : "Every step has a guarding rule."}
      </p>
      <ul className="ui-ranked">
        {d.steps.map((s) => (
          <li key={s.id}>
            <div className="ui-ranked__row">
              <span className="ui-ranked__title">{s.label}</span>
              <span className="ui-ranked__num">{s.guard_count} {s.guard_count === 1 ? "rule" : "rules"}</span>
              <span className="ui-ranked__meta">
                {s.tcode ? <><Mono>{s.tcode}</Mono>, </> : null}
                {s.min_pass_rate != null ? `lowest pass rate ${pct(s.min_pass_rate)}` : "no pass rate"}
                {s.unguarded_fields.length ? `. Unguarded: ${s.unguarded_fields.join(", ")}` : ""}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function BlastPanel({ checkId, versionId }: { checkId: string; versionId: string }) {
  const q = useQuery({ queryKey: ["lineage.blast", versionId, checkId], queryFn: () => getBlastRadius(versionId, checkId) });
  if (q.isLoading) return <TableSkeleton rows={3} label="Loading blast radius" />;
  if (q.error || !q.data) return <Banner tone="danger" title="Blast radius could not be read" />;
  const d = q.data;
  if (!d.failing_records) return <EmptyState>No failing records are stored for {checkId} in this version.</EmptyState>;
  return (
    <>
      <p className="ui-note">
        {d.failing_records.toLocaleString()} failing {d.grain ?? ""} {d.failing_records === 1 ? "record" : "records"}{d.keys_truncated ? " (capped)" : ""} on{" "}
        {d.object ?? "an unmapped object"} touch {d.processes_touched.length.toLocaleString()} {d.processes_touched.length === 1 ? "process" : "processes"}.
      </p>
      {d.targets.length ? (
        <ul className="ui-ranked">
          {d.targets.map((t) => (
            <li key={t.table}>
              <div className="ui-ranked__row">
                <span className="ui-ranked__title">{t.label}</span>
                <span className="ui-ranked__num">{t.status === "ok" ? `${t.documents.toLocaleString()} documents` : ""}</span>
                <span className="ui-ranked__meta">
                  <Mono>{t.table}</Mono>
                  {t.status === "ok" ? `, ${t.objects_touched.toLocaleString()} master records, joined on ${t.joined_on.join(", ")}`
                    : t.status === "not_extracted" ? ", not extracted" : ", record key lacks the join field"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : <EmptyState>No transactional documents are modelled for this object.</EmptyState>}
    </>
  );
}

export function LineageSurface() {
  const [draft, setDraft] = useState("LFB1.ZTERM");
  const [focus, setFocus] = useState("LFB1.ZTERM");
  const [direction, setDirection] = useState<LineageDirection>("both");
  const [depth, setDepth] = useState(4);
  const drawer = useDrawerParam("node");
  const { latest } = useLatestVersion();

  const modelQ = useQuery({ queryKey: ["lineage.model"], queryFn: getLineageModel });
  const impactQ = useQuery({ queryKey: ["lineage.impact", latest?.id], queryFn: () => getLineageImpact(latest!.id), enabled: !!latest });
  const graphQ = useQuery({ queryKey: ["lineage.graph", focus, direction, depth], queryFn: () => getLineage({ node: focus, direction, depth }), retry: false });

  const impact = impactQ.data;
  const rows = useMemo(() => (impact ? [...impact.kpis, ...impact.processes, ...impact.features] : []), [impact]);
  const worst = useMemo(() => new Map(rows.map((r) => [r.id, r.worst_impact])), [rows]);

  const { nodes, edges, capped } = useMemo(() => {
    const g = graphQ.data;
    if (!g) return { nodes: [], edges: [], capped: false };
    const keep = [...g.nodes].sort((a, b) => Math.abs(a.depth) - Math.abs(b.depth)).slice(0, MAX_NODES);
    const ids = new Set(keep.map((n) => n.id));
    return {
      capped: g.nodes.length > keep.length,
      nodes: keep.map((n) => {
        const w = worst.get(n.id);
        return { id: n.id, data: { label: n.label, kind: KIND[n.type] ?? "transform", stepId: n.type, secondary: n.tcode,
          alignment: w === "full_block" ? "blocked" as const : w === "degraded" ? "drifting" as const : w ? "aligned" as const : "unknown" as const } };
      }),
      edges: g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e, i) => ({ id: `${e.source}-${e.target}-${i}`, source: e.source, target: e.target, label: e.rel })),
    };
  }, [graphQ.data, worst]);

  const columns = useMemo<ColumnDef<ImpactRow, unknown>[]>(() => [
    { id: "name", header: "Name", meta: meta({ minWidth: 240 }), accessorFn: (r) => r.label },
    { id: "type", header: "Type", meta: meta({ width: 100 }), accessorFn: (r) => TYPE_LABEL[r.type] },
    { id: "findings", header: "Findings", meta: meta({ width: 100, numeric: true }), accessorFn: (r) => r.findings },
    { id: "records", header: "Records", meta: meta({ width: 150, numeric: true }), accessorFn: (r) => r.records_affected,
      cell: ({ row }) => `${row.original.records_affected.toLocaleString()} (at least ${row.original.max_records.toLocaleString()})` },
    { id: "blocks", header: "Effect", meta: meta({ width: 110 }), accessorFn: (r) => r.worst_impact ?? "",
      cell: ({ row }) => row.original.worst_impact === "full_block" ? "Blocks" : row.original.worst_impact === "degraded" ? "Degrades" : "" },
    { id: "worst", header: "Worst", meta: meta({ width: 110 }), accessorFn: (r) => r.worst_severity ?? "",
      cell: ({ row }) => row.original.worst_severity ? <StatusBadge status={SEV[row.original.worst_severity]}>{row.original.worst_severity}</StatusBadge> : null },
  ], []);

  const trace = (id: string) => { setDraft(id); setFocus(id); drawer.open(id); };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); if (draft.trim()) { setFocus(draft.trim()); drawer.close(); } };

  if (modelQ.isLoading) return <div className="ui-page"><TableSkeleton rows={8} label="Loading lineage model" /></div>;
  if (modelQ.error || !modelQ.data) return <div className="ui-page"><Banner tone="danger" title="The lineage model could not be read" /></div>;
  const model = modelQ.data;
  const sel = drawer.value ? graphQ.data?.nodes.find((n) => n.id === drawer.value) ?? null : null;
  const selType = sel?.type;
  const neighbours = sel ? (graphQ.data?.edges ?? []).filter((e) => e.source === sel.id || e.target === sel.id) : [];
  const label = (id: string) => graphQ.data?.nodes.find((n) => n.id === id)?.label ?? id;
  const kpis = impact?.kpis.length ?? 0, features = impact?.features.length ?? 0;

  return (
    <div className="ui-page">
      <PageHeader title="Lineage" summary={`SAP field to config, process step, SAP feature and business KPI. Model ${model.model_version}, ${model.edge_count.toLocaleString()} edges.`} />
      <Tally level={4} label="Lineage figures" figures={[
        { label: "Nodes in view", value: graphQ.data ? nodes.length : null, loading: graphQ.isLoading, href: "/process?tab=lineage", verdict: capped ? `Nearest ${MAX_NODES} of ${graphQ.data?.nodes.length.toLocaleString()}.` : "Everything the trace reaches." },
        { label: "Edges in view", value: graphQ.data ? edges.length : null, loading: graphQ.isLoading, href: "/process?tab=lineage", verdict: "Links between those nodes." },
        { label: "KPIs at risk", value: impact ? kpis : null, loading: impactQ.isLoading, href: "/process?tab=lineage", tone: kpis ? "danger" : undefined,
          verdict: impact ? (kpis ? `Of ${model.kpis.length} modelled.` : "Nothing at risk.") : "Needs a completed version." },
        { label: "Features at risk", value: impact ? features : null, loading: impactQ.isLoading, href: "/process?tab=readiness", tone: features ? "warning" : undefined,
          verdict: impact ? (features ? "SAP features a failing rule blocks." : "Nothing blocked.") : "Needs a completed version." },
      ]} />

      <SectionCard title="Trace" meta={graphQ.data?.paths_to_kpis.length ? `${graphQ.data.paths_to_kpis.length} paths reach a KPI` : undefined}>
        <form onSubmit={onSubmit} className="ui-filterbar">
          <Input aria-label="Node to trace" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="LFB1.ZTERM, AP017, kpi:dpo" />
          <Select aria-label="Direction" value={direction} onValueChange={(v) => setDirection(v as LineageDirection)}
            options={[{ value: "both", label: "Up and downstream" }, { value: "down", label: "Downstream" }, { value: "up", label: "Upstream" }]} />
          <Select aria-label="Depth" value={String(depth)} onValueChange={(v) => setDepth(Number(v))}
            options={[2, 3, 4, 6, 8, 12].map((n) => ({ value: String(n), label: `Depth ${n}` }))} />
          <Button type="submit">Trace</Button>
        </form>
        {graphQ.isLoading ? <TableSkeleton rows={5} label="Loading trace" />
          : graphQ.error ? <Banner tone="warning" title={`${focus} is not in the lineage model`} />
          : nodes.length ? (
            <ProcessGraphEmergence remountKey={`${focus}-${direction}-${depth}`}>
              <ProcessGraph nodes={nodes} edges={edges} height={520} onNodeClick={(n) => drawer.open(n.id)} />
            </ProcessGraphEmergence>
          ) : <EmptyState>Nothing is linked to this node.</EmptyState>}
      </SectionCard>

      <SectionCard title="Reached by failing rules" meta={impact ? `${rows.length.toLocaleString()} shown. Select a row to trace it.` : undefined} flush>
        <DataTable columns={columns} data={rows} getRowId={(r) => r.id} ariaLabel="Impact by KPI, process and feature" maxHeight="50vh"
          onRowActivate={(r) => trace(r.id)}
          empty={<EmptyState>{impactQ.isLoading ? "Reading impact." : latest ? "No failing rule reaches a KPI, process or feature." : "Impact needs a completed analysis."}</EmptyState>} />
      </SectionCard>

      <DetailDrawer open={!!sel} onClose={drawer.close} ariaLabel="Node detail"
        header={sel ? <div className="ui-drawer-head"><StatusBadge status="idle">{sel.type}</StatusBadge><h2 className="ui-drawer-head__title">{sel.label}</h2></div> : null}>
        {sel ? (
          <div className="ui-detail">
            <p className="ui-note"><Mono>{sel.id}</Mono>{sel.tcode ? <>, <Mono>{sel.tcode}</Mono></> : null}</p>
            {sel.definition ? <p className="ui-note">{sel.definition}</p> : null}
            <div><Button onClick={() => { setDraft(sel.id); setFocus(sel.id); }}>Trace from here</Button></div>
            {selType === "object" ? <p className="ui-note"><Link className="ui-link" href={`/analyse/object/${encodeURIComponent(sel.label)}`}>Open the object</Link></p> : null}
            {selType === "kpi" || selType === "feature" || selType === "process" || selType === "step" ? <GuardsPanel node={sel.id} versionId={latest?.id} /> : null}
            {selType === "check" ? (latest ? <BlastPanel checkId={sel.id.slice("check:".length)} versionId={latest.id} /> : <EmptyState>Blast radius needs a completed analysis.</EmptyState>) : null}
            {neighbours.length ? (
              <ul className="ui-ranked">
                {neighbours.slice(0, 20).map((e, i) => (
                  <li key={i}><div className="ui-ranked__row">
                    <span className="ui-ranked__title">{label(e.source === sel.id ? e.target : e.source)}</span>
                    <span className="ui-ranked__meta">{e.source === sel.id ? "downstream" : "upstream"}, {e.rel}</span>
                  </div></li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </DetailDrawer>
    </div>
  );
}

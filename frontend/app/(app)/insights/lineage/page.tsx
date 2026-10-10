// frontend/app/(app)/insights/lineage/page.tsx
"use client";

/**
 * SAP field to config, process step, SAP feature and business KPI, drawn as
 * a force-directed graph. Trace any node; the table ranks the KPIs,
 * processes and features the latest version's failing rules reach.
 * Selecting a node opens its guarding rules or blast radius.
 */

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Button, DataTable, Drawer, EmptyState, ErrorState, Graph, type GraphEdge, type GraphNode,
  Mono, Pill, type PillTone, ReportPage, Select, Skeleton,
} from "@/design";
import { useLatestVersion } from "@/components/process/shared";
import {
  getBlastRadius, getLineage, getLineageGuards, getLineageImpact, getLineageModel,
  type ImpactRow, type LineageDirection, type LineageNode, type Severity,
} from "@/lib/api/lineage";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";

const pct = (v: number | null | undefined) => (v == null ? "" : `${(v * 100).toFixed(1)}%`);
// ponytail: force layout past this many nodes is unreadable. Narrow the trace depth to see the rest.
const MAX_NODES = 150;

const SEV_TONE: Record<Severity, PillTone> = { low: "neutral", medium: "at-risk", high: "no-go", critical: "no-go" };
const TYPE_LABEL: Record<ImpactRow["type"], string> = { kpi: "KPI", process: "Process", feature: "Feature" };

function GuardsPanel({ node, versionId }: { node: string; versionId?: string }) {
  const q = useQuery({
    queryKey: queryKeys.lineageGuards(node, versionId),
    queryFn: () => getLineageGuards({ node, version_id: versionId }),
  });
  if (q.isLoading) return <Skeleton height={120} />;
  if (q.error || !q.data) return <EmptyState title="Guards could not be read." />;
  const d = q.data;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
        {d.steps.length.toLocaleString()} {d.steps.length === 1 ? "step feeds" : "steps feed"} this node.{" "}
        {d.coverage_gaps.length ? `${d.coverage_gaps.length.toLocaleString()} have no guarding rule.` : "Every step has a guarding rule."}
      </p>
      <ul className="flex flex-col gap-2">
        {d.steps.map((s) => (
          <li key={s.id} className="border-b py-2" style={{ borderColor: "var(--m-line)" }}>
            <div className="flex items-center gap-3">
              <span className="flex-1">{s.label}</span>
              <span className="text-[13px]">{s.guard_count} {s.guard_count === 1 ? "rule" : "rules"}</span>
            </div>
            <div className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
              {s.tcode ? <><Mono>{s.tcode}</Mono>, </> : null}
              {s.min_pass_rate != null ? `lowest pass rate ${pct(s.min_pass_rate)}` : "no pass rate"}
              {s.unguarded_fields.length ? `. Unguarded: ${s.unguarded_fields.join(", ")}` : ""}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BlastPanel({ checkId, versionId }: { checkId: string; versionId: string }) {
  const q = useQuery({
    queryKey: queryKeys.lineageBlast(versionId, checkId),
    queryFn: () => getBlastRadius(versionId, checkId),
  });
  if (q.isLoading) return <Skeleton height={120} />;
  if (q.error || !q.data) return <EmptyState title="Blast radius could not be read." />;
  const d = q.data;
  if (!d.failing_records) return <EmptyState title={`No failing records are stored for ${checkId} in this version.`} />;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
        {d.failing_records.toLocaleString()} failing {d.grain ?? ""} {d.failing_records === 1 ? "record" : "records"}{d.keys_truncated ? " (capped)" : ""} on{" "}
        {d.object ?? "an unmapped object"} touch {d.processes_touched.length.toLocaleString()} {d.processes_touched.length === 1 ? "process" : "processes"}.
      </p>
      {d.targets.length ? (
        <ul className="flex flex-col gap-2">
          {d.targets.map((t) => (
            <li key={t.table} className="border-b py-2" style={{ borderColor: "var(--m-line)" }}>
              <div className="flex items-center gap-3">
                <span className="flex-1">{t.label}</span>
                <span className="text-[13px]">{t.status === "ok" ? `${t.documents.toLocaleString()} documents` : ""}</span>
              </div>
              <div className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
                <Mono>{t.table}</Mono>
                {t.status === "ok" ? `, ${t.objects_touched.toLocaleString()} master records, joined on ${t.joined_on.join(", ")}`
                  : t.status === "not_extracted" ? ", not extracted" : ", record key lacks the join field"}
              </div>
            </li>
          ))}
        </ul>
      ) : <EmptyState title="No transactional documents are modelled for this object." />}
    </div>
  );
}

export default function LineagePage() {
  const [draft, setDraft] = useState("LFB1.ZTERM");
  const [focus, setFocus] = useState("LFB1.ZTERM");
  const [direction, setDirection] = useState<LineageDirection>("both");
  const [depth, setDepth] = useState(4);
  const [selId, setSelId] = useState<string | null>(null);
  const { latest } = useLatestVersion();
  const dayOne = useDayOne();

  const modelQ = useQuery({ queryKey: queryKeys.lineageModel(), queryFn: getLineageModel });
  const impactQ = useQuery({
    queryKey: queryKeys.lineageImpact(latest?.id),
    queryFn: () => getLineageImpact(latest!.id),
    enabled: !!latest,
  });
  const graphQ = useQuery({
    queryKey: queryKeys.lineageGraph(focus, direction, depth),
    queryFn: () => getLineage({ node: focus, direction, depth }),
    retry: false,
  });

  const impact = impactQ.data;
  const rows = useMemo(() => (impact ? [...impact.kpis, ...impact.processes, ...impact.features] : []), [impact]);
  const worst = useMemo(() => new Map(rows.map((r) => [r.id, r.worst_impact])), [rows]);

  const { nodes, edges, capped } = useMemo(() => {
    const g = graphQ.data;
    if (!g) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[], capped: false };
    const keep = [...g.nodes].sort((a, b) => Math.abs(a.depth) - Math.abs(b.depth)).slice(0, MAX_NODES);
    const ids = new Set(keep.map((n) => n.id));
    return {
      capped: g.nodes.length > keep.length,
      nodes: keep.map((n) => ({ id: n.id, label: n.label, size: 4 + (worst.get(n.id) ? 4 : 0) })),
      edges: g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e, i) => (
        { id: `${e.source}-${e.target}-${i}`, source: e.source, target: e.target, label: e.rel }
      )),
    };
  }, [graphQ.data, worst]);

  const columns = useMemo<ColumnDef<ImpactRow>[]>(() => [
    { id: "name", header: "Name", accessorFn: (r) => r.label },
    { id: "type", header: "Type", accessorFn: (r) => TYPE_LABEL[r.type] },
    { id: "findings", header: "Findings", accessorFn: (r) => r.findings },
    {
      id: "records", header: "Records", accessorFn: (r) => r.records_affected,
      cell: ({ row }) => `${row.original.records_affected.toLocaleString()} (at least ${row.original.max_records.toLocaleString()})`,
    },
    {
      id: "blocks", header: "Effect", accessorFn: (r) => r.worst_impact ?? "",
      cell: ({ row }) => row.original.worst_impact === "full_block" ? "Blocks" : row.original.worst_impact === "degraded" ? "Degrades" : "",
    },
    {
      id: "worst", header: "Worst", accessorFn: (r) => r.worst_severity ?? "",
      cell: ({ row }) => row.original.worst_severity ? <Pill tone={SEV_TONE[row.original.worst_severity]}>{row.original.worst_severity}</Pill> : null,
    },
  ], []);

  const trace = (id: string) => { setDraft(id); setFocus(id); setSelId(id); };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); if (draft.trim()) { setFocus(draft.trim()); setSelId(null); } };

  if (modelQ.isLoading) return <div className="p-6"><Skeleton height={240} /></div>;
  if (modelQ.error) {
    return <div className="p-6"><ErrorState message={apiErrorMessage(modelQ.error)} onRetry={() => void modelQ.refetch()} /></div>;
  }
  if (!modelQ.data) return <div className="p-6"><EmptyState title="The lineage model could not be read." /></div>;
  const model = modelQ.data;
  const sel: LineageNode | null = selId ? graphQ.data?.nodes.find((n) => n.id === selId) ?? null : null;
  const neighbours = sel ? (graphQ.data?.edges ?? []).filter((e) => e.source === sel.id || e.target === sel.id) : [];
  const label = (id: string) => graphQ.data?.nodes.find((n) => n.id === id)?.label ?? id;
  const kpis = impact?.kpis.length ?? 0;
  const features = impact?.features.length ?? 0;

  return (
    <>
      <ReportPage
        narrative={`SAP field to config, process step, SAP feature and business KPI. Model ${model.model_version}, ${model.edge_count.toLocaleString()} edges. ${impact ? `${kpis.toLocaleString()} KPIs and ${features.toLocaleString()} features at risk.` : "Impact needs a completed analysis."}`}
        charts={
          <div className="flex flex-col gap-3">
            <form onSubmit={onSubmit} className="flex items-center gap-2">
              <input
                aria-label="Node to trace" value={draft} onChange={(e) => setDraft(e.target.value)}
                placeholder="LFB1.ZTERM, AP017, kpi:dpo"
                className="rounded border px-2 py-1 text-[13px]" style={{ borderColor: "var(--m-line)" }}
              />
              <Select value={direction} onValueChange={(v) => setDirection(v as LineageDirection)}
                options={[{ value: "both", label: "Up and downstream" }, { value: "down", label: "Downstream" }, { value: "up", label: "Upstream" }]} />
              <Select value={String(depth)} onValueChange={(v) => setDepth(Number(v))}
                options={[2, 3, 4, 6, 8, 12].map((n) => ({ value: String(n), label: `Depth ${n}` }))} />
              <Button type="submit">Trace</Button>
            </form>
            {graphQ.isLoading ? <Skeleton height={240} />
              : graphQ.error ? (
                <ErrorState message={apiErrorMessage(graphQ.error)} onRetry={() => void graphQ.refetch()} />
              )
              : nodes.length ? (
                <>
                  <Graph nodes={nodes} edges={edges} height={420} onNodeClick={(id) => setSelId(id)} />
                  {capped ? <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>Nearest {MAX_NODES} of {graphQ.data?.nodes.length.toLocaleString()} nodes shown.</p> : null}
                </>
              ) : <EmptyState title="Nothing is linked to this node." />}
          </div>
        }
        tables={
          <DataTable
            columns={columns}
            data={rows}
            getRowId={(r) => r.id}
            onRowClick={(r) => trace(r.id)}
          />
        }
        state={impactQ.isLoading || dayOne.status === "loading" ? "loading" : isListFailure(impactQ) ? "error" : rows.length === 0 ? "empty" : undefined}
        emptyProps={
          latest
            ? { title: "No failing rule reaches a KPI, process or feature." }
            : {
                title: "No lineage yet.",
                detail: dayOne.step?.detail ?? "Impact needs a completed analysis.",
                action: <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />,
              }
        }
        errorProps={{ message: apiErrorMessage(impactQ.error), onRetry: () => impactQ.refetch() }}
      />

      <Drawer open={!!sel} onOpenChange={(o) => { if (!o) setSelId(null); }} title={sel?.label ?? ""}>
        {sel ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
              <Mono>{sel.id}</Mono>{sel.tcode ? <>, <Mono>{sel.tcode}</Mono></> : null}
            </p>
            {sel.definition ? <p className="text-[13px]">{sel.definition}</p> : null}
            <div><Button onClick={() => { setDraft(sel.id); setFocus(sel.id); }}>Trace from here</Button></div>
            {sel.type === "object" ? (
              <p className="text-[13px]"><Link className="underline" href={`/analyse/object/${encodeURIComponent(sel.label)}`}>Open the object</Link></p>
            ) : null}
            {sel.type === "kpi" || sel.type === "feature" || sel.type === "process" || sel.type === "step"
              ? <GuardsPanel node={sel.id} versionId={latest?.id} /> : null}
            {sel.type === "check"
              ? (latest ? <BlastPanel checkId={sel.id.slice("check:".length)} versionId={latest.id} /> : <EmptyState title="Blast radius needs a completed analysis." />)
              : null}
            {neighbours.length ? (
              <ul className="flex flex-col gap-2">
                {neighbours.slice(0, 20).map((e, i) => (
                  <li key={i} className="border-b py-2" style={{ borderColor: "var(--m-line)" }}>
                    <div className="flex items-center gap-3">
                      <span className="flex-1">{label(e.source === sel.id ? e.target : e.source)}</span>
                      <span className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>{e.source === sel.id ? "downstream" : "upstream"}, {e.rel}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </>
  );
}

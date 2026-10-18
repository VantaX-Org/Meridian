// frontend/app/(app)/insights/lineage/page.tsx
"use client";

/**
 * SAP field to config, process step, SAP feature and business KPI, drawn as
 * a layered trace in data-flow order. Trace any node; the table ranks the
 * KPIs, processes and features the selected run's failing rules reach.
 * Selecting a node opens its guarding rules or blast radius.
 */

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, Drawer, EmptyState, ErrorState, Input, LineageChart, type LineageChartEdge, type LineageChartNode, Card, Mono, Select, Skeleton, Status } from "@/design";
import { useLatestVersion } from "@/components/process/shared";
import { getFindings } from "@/lib/api/findings";
import {
  getBlastRadius, getLineage, getLineageGuards, getLineageImpact, getLineageModel,
  type ImpactRow, type LineageDirection, type LineageNode,
} from "@/lib/api/lineage";
import { apiErrorMessage, isListFailure, apiErrorState } from "@/lib/error";
import { runScopeLabel } from "@/lib/run-scope";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { CardSkeleton, InsightFrame } from "../_components/InsightFrame";
import { atRiskSentence, findingsHref, pct } from "./links";

// ponytail: the layered chart past this many nodes gets taller than a screen. Narrow the trace depth to see the rest.
const MAX_NODES = 150;

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
      <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>
        {d.steps.length.toLocaleString()} {d.steps.length === 1 ? "step feeds" : "steps feed"} this node.{" "}
        {d.coverage_gaps.length ? `${d.coverage_gaps.length.toLocaleString()} have no guarding rule.` : "Every step has a guarding rule."}
      </p>
      <ul className="flex flex-col gap-2">
        {d.steps.map((s) => (
          <li key={s.id} className="border-b py-2" style={{ borderColor: "var(--m-line)" }}>
            <div className="flex items-center gap-3">
              <span className="flex-1">{s.label}</span>
              <span className="m-text-body">{s.guard_count} {s.guard_count === 1 ? "rule" : "rules"}</span>
            </div>
            <div className="m-text-body" style={{ color: "var(--m-ink-2)" }}>
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
      <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>
        {d.failing_records.toLocaleString()} failing {d.grain ?? ""} {d.failing_records === 1 ? "record" : "records"}{d.keys_truncated ? " (capped)" : ""} on{" "}
        {d.object ?? "an unmapped object"} touch {d.processes_touched.length.toLocaleString()} {d.processes_touched.length === 1 ? "process" : "processes"}.
      </p>
      {d.targets.length ? (
        <ul className="flex flex-col gap-2">
          {d.targets.map((t) => (
            <li key={t.table} className="border-b py-2" style={{ borderColor: "var(--m-line)" }}>
              <div className="flex items-center gap-3">
                <span className="flex-1">{t.label}</span>
                <span className="m-text-body">{t.status === "ok" ? `${t.documents.toLocaleString()} documents` : ""}</span>
              </div>
              <div className="m-text-body" style={{ color: "var(--m-ink-2)" }}>
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
  const [draft, setDraft] = useState("");
  const [focusPick, setFocus] = useState("");
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
  const impact = impactQ.data;
  const rows = useMemo(() => (impact ? [...impact.kpis, ...impact.processes, ...impact.features] : []), [impact]);
  // Until the viewer traces something, trace the worst real node from the impact rows.
  const focus = focusPick || rows[0]?.id || "";
  const graphQ = useQuery({
    queryKey: queryKeys.lineageGraph(focus, direction, depth),
    queryFn: () => getLineage({ node: focus, direction, depth }),
    retry: false,
    enabled: !!focus,
  });
  const worst = useMemo(() => new Map(rows.map((r) => [r.id, r.worst_impact])), [rows]);
  // The object of each failing rule in this run, so a single-rule row can open that rule's failing records.
  const singleChecks = useMemo(() => [...new Set(rows.flatMap((r) => (r.check_ids.length === 1 ? r.check_ids : [])))], [rows]);
  const findingsQ = useQuery({
    queryKey: ["lineage", "check-modules", latest?.id],
    queryFn: () => getFindings({ version_id: latest!.id, sort: "impact", limit: 200 }),
    enabled: !!latest && singleChecks.length > 0,
    retry: false,
    meta: { ignoreError: true },
  });
  const moduleByCheck = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of findingsQ.data?.findings ?? []) if (!m.has(f.check_id)) m.set(f.check_id, f.module);
    return m;
  }, [findingsQ.data]);

  const { nodes, edges, capped } = useMemo(() => {
    const g = graphQ.data;
    if (!g) return { nodes: [] as LineageChartNode[], edges: [] as LineageChartEdge[], capped: false };
    const keep = [...g.nodes].sort((a, b) => Math.abs(a.depth) - Math.abs(b.depth)).slice(0, MAX_NODES);
    const ids = new Set(keep.map((n) => n.id));
    return {
      capped: g.nodes.length > keep.length,
      nodes: keep.map((n) => ({ id: n.id, type: n.type, label: n.label, atRisk: worst.has(n.id) })),
      edges: g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ source: e.source, target: e.target, impact: e.impact_type })),
    };
  }, [graphQ.data, worst]);

  const columns = useMemo<ColumnDef<ImpactRow>[]>(() => [
    { id: "name", header: "Name", accessorFn: (r) => r.label, size: 280, cell: ({ row }) => <span className="whitespace-nowrap">{row.original.label}</span> },
    { id: "type", header: "Type", accessorFn: (r) => TYPE_LABEL[r.type], size: 120 },
    { id: "hops", header: "Hops", accessorFn: (r) => r.min_hops, size: 72, meta: { numeric: true } },
    {
      id: "findings", header: "Findings", accessorFn: (r) => r.findings, size: 96, meta: { numeric: true },
      cell: ({ row }) => {
        const ids = row.original.check_ids;
        const href = findingsHref(ids, latest?.id, (id) => moduleByCheck.get(id));
        return <Link className="underline underline-offset-2" href={href} title={ids.join(", ")} onClick={(e) => e.stopPropagation()}>{row.original.findings.toLocaleString()}</Link>;
      },
    },
    {
      id: "records", header: "Records affected", accessorFn: (r) => r.records_affected, size: 220, meta: { numeric: true },
      cell: ({ row }) => <span className="whitespace-nowrap">{row.original.max_records < row.original.records_affected
        ? `${row.original.max_records.toLocaleString()} to ${row.original.records_affected.toLocaleString()}`
        : row.original.records_affected.toLocaleString()}</span>,
    },
    {
      id: "blocks", header: "Effect", accessorFn: (r) => r.worst_impact ?? "", size: 120,
      cell: ({ row }) => row.original.worst_impact === "full_block" ? "Blocks" : row.original.worst_impact === "degraded" ? "Degrades" : row.original.worst_impact === "cosmetic" ? "Cosmetic" : "Not modelled",
    },
    {
      id: "worst", header: "Severity", accessorFn: (r) => r.worst_severity ?? "", size: 110,
      cell: ({ row }) => row.original.worst_severity ? <Status kind="severity" value={row.original.worst_severity} /> : null,
    },
  ], [latest, moduleByCheck]);

  const trace = (id: string) => { setDraft(id); setFocus(id); setSelId(id); };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); if (draft.trim()) { setFocus(draft.trim()); setSelId(null); } };

  if (modelQ.isLoading) return <InsightFrame title="Lineage" state="loading" />;
  if (modelQ.error) {
    return <InsightFrame title="Lineage" state="error" errorProps={{ message: apiErrorMessage(modelQ.error), onRetry: () => void modelQ.refetch() }} />;
  }
  if (!modelQ.data) return <InsightFrame title="Lineage" state="empty" emptyProps={{ title: "The lineage model could not be read", action: <Button onClick={() => void modelQ.refetch()}>Retry</Button> }} />;
  const model = modelQ.data;
  const sel: LineageNode | null = selId ? graphQ.data?.nodes.find((n) => n.id === selId) ?? null : null;
  const neighbours = sel ? (graphQ.data?.edges ?? []).filter((e) => e.source === sel.id || e.target === sel.id) : [];
  const label = (id: string) => graphQ.data?.nodes.find((n) => n.id === id)?.label ?? rows.find((r) => r.id === id)?.label ?? id;
  const kpis = impact?.kpis.length ?? 0;
  const features = impact?.features.length ?? 0;

  return (
    <>
      <InsightFrame
        title="Lineage"
        meta={`Model ${model.model_version}, ${model.edge_count.toLocaleString()} links${latest ? `, as of ${runScopeLabel(latest)}` : ""}`}
        run={latest?.id}
        insight={{
          situation: { sentence: impact ? atRiskSentence(kpis, features) : "Impact needs a completed analysis", tone: kpis ? "at-risk" : "neutral" },
          changed: { sentence: focus ? `Tracing ${label(focus)}: ${nodes.length.toLocaleString()} nodes within ${depth} hops` : "Nothing traced yet" },
          why: { sentence: impact ? `${rows.length.toLocaleString()} KPIs, processes and features are reached by failing rules` : "—" },
          next: { sentence: rows[0] ? `Trace ${rows[0].label}` : "Run an analysis", action: rows[0] ? { label: "Trace it", onClick: () => trace(rows[0].id) } : undefined },
        }}
        state={dayOne.status === "loading" ? "loading" : undefined}
        skeleton={<><CardSkeleton height={520} /><CardSkeleton height={200} /></>}
      >
        <Card title="Field to KPI trace">
          <div className="flex flex-col gap-3">
            <form onSubmit={onSubmit} className="flex items-center gap-2">
              <Input aria-label="Node to trace" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Field, rule or KPI id" />
              <Select label="Direction" value={direction} onValueChange={(v) => setDirection(v as LineageDirection)}
                options={[{ value: "both", label: "Up and downstream" }, { value: "down", label: "Downstream" }, { value: "up", label: "Upstream" }]} />
              <Select label="Depth" value={String(depth)} onValueChange={(v) => setDepth(Number(v))}
                options={[2, 3, 4, 6, 8, 12].map((n) => ({ value: String(n), label: `Depth ${n}` }))} />
              <Button type="submit">Trace</Button>
            </form>
            {!focus ? <EmptyState title="Enter a field, rule or KPI to trace" detail="The trace shows what feeds it and what it feeds." ghost="grid" />
              : graphQ.isLoading ? <Skeleton height={240} />
              : graphQ.error ? (
                <ErrorState {...apiErrorState(graphQ.error)} onRetry={() => void graphQ.refetch()} />
              )
              : nodes.length ? (
                <>
                  <LineageChart nodes={nodes} edges={edges} focusId={focus} selectedId={selId} onNodeClick={(id) => setSelId(id)} />
                  <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>
                    {nodes.length.toLocaleString()} nodes and {edges.length.toLocaleString()} links {direction === "both" ? "up and downstream of" : direction === "up" ? "upstream of" : "downstream of"} {label(focus)}.
                    {capped ? ` Nearest ${MAX_NODES} of ${graphQ.data?.nodes.length.toLocaleString()} nodes shown; narrow the depth to see the rest.` : ""}
                    {" "}Red squares are reached by a failing rule. Red and orange links block or degrade their target.
                  </p>
                </>
              ) : <EmptyState title="Nothing is linked to this node" detail="Try a node from the table below, or a wider depth." action={rows[0] ? <Button onClick={() => trace(rows[0].id)}>{`Trace ${rows[0].label}`}</Button> : <Button render={<Link href="/rules">Open rules</Link>} />} />}
          </div>
        </Card>
        <Card title="KPIs, processes and features at risk">
          {impactQ.isLoading ? <Skeleton height={160} />
            : isListFailure(impactQ) ? <ErrorState {...apiErrorState(impactQ.error)} onRetry={() => void impactQ.refetch()} />
            : rows.length === 0 ? (
              latest
                ? <EmptyState title="No failing rule reaches a KPI, process or feature" action={<Button render={<Link href="/rules">Open rules</Link>} />} />
                : <EmptyState title="No lineage yet" detail={dayOne.step?.detail ?? "Impact needs a completed analysis."} action={<DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />} />
            )
            : <DataTable columns={columns} data={rows} getRowId={(r) => r.id} onRowClick={(r) => trace(r.id)} hideToolbar dense height="auto" />}
        </Card>
      </InsightFrame>

      <Drawer open={!!sel} onOpenChange={(o) => { if (!o) setSelId(null); }} title={sel?.label ?? ""}
        subtitle={sel ? <><Mono>{sel.id}</Mono>{sel.tcode ? <>, <Mono>{sel.tcode}</Mono></> : null}</> : null}>
        {sel ? (
          <div className="flex flex-col gap-3">
            {sel.definition ? <p className="m-text-body">{sel.definition}</p> : null}
            <div><Button onClick={() => trace(sel.id)}>Trace from here</Button></div>
            {sel.type === "object" ? (
              <p className="m-text-body"><Link className="underline" href={`/objects/${encodeURIComponent(sel.id.replace(/^object:/, ""))}${latest ? `?run=${latest.id}` : ""}`}>Open the object</Link></p>
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
                      <span className="m-text-body" style={{ color: "var(--m-ink-2)" }}>{e.source === sel.id ? "Downstream" : "Upstream"}, {e.rel.replaceAll("_", " ")}</span>
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

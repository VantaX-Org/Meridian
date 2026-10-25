"use client";

/**
 * Flow tab (process-discovery spec §7.3): the DFG between the children of the current node.
 * Node size is cases, edge width is count, the edge label is the median wait.
 * A node click drills one level, to L4 at most; at L4 the L5 nodes open a Drawer.
 */
import { useState, type ComponentProps } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, Drawer, EmptyState, ErrorState, Mono, Skeleton } from "@/design";
import type { Graph as GraphChart } from "@/design/charts/Graph";
import { domainOf, type DomainKey } from "@/design/tokens";
import { getDfg, type Dfg, type NodeStats, type ProcessFilterParams } from "@/lib/api/process-discovery";
import { apiErrorState } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import type { L4, ProcessModelDocument } from "@/types/process-model";
import { findActivity, locate } from "@/app/(app)/insights/process/designer/_components/doc";
import { bottleneckKeys, isRework } from "./edge-marks";
import { usePulseOnce } from "./use-pulse-once";
import { L5Table } from "./l5-table";
import { DqDefects, fmtCount, fmtFitness, fmtSeconds, fmtShare, ViewAsTable } from "./shared";

/** Lazy chunk with a fixed 420px slot so the flow does not shift when it arrives. */
type GraphProps = ComponentProps<typeof GraphChart>;
type LegendProps = { domains: DomainKey[]; bottleneck: boolean; rework: boolean };
type FlowGraphProps = GraphProps & { legend: LegendProps };
// The legend ships in the same lazy chunk as the Graph, so the main chunk stays free of it.
const Graph = dynamic<FlowGraphProps>(() => import("@/design/charts/Graph").then((m) => {
  const FlowGraph = ({ legend, ...p }: FlowGraphProps) => (
    <div className="grid gap-2"><m.GraphLegend {...legend} /><div className="overflow-x-auto"><m.Graph {...p} /></div></div>
  );
  return FlowGraph;
}), { ssr: false, loading: () => <Skeleton height={420} /> });

type Edge = Dfg["edges"][number];
const PSEUDO = new Set(["START", "END"]);
const PSEUDO_LABEL: Record<string, string> = { START: "Start", END: "End" };

/** `l1`: the process the nodes belong to, so a DQ defects count opens that process's readiness. */
const nodeColumns = (l1: string | undefined): ColumnDef<NodeStats>[] => [
  { accessorKey: "id", header: "ID", cell: ({ row }) => <Mono>{row.original.id}</Mono> },
  { accessorKey: "name", header: "Name" },
  { accessorKey: "case_count", header: "Cases", cell: ({ row }) => fmtCount(row.original.case_count) },
  { accessorKey: "share", header: "Share", cell: ({ row }) => fmtShare(row.original.share) },
  { accessorKey: "median_seconds", header: "Median", cell: ({ row }) => fmtSeconds(row.original.median_seconds) },
  { accessorKey: "fitness", header: "Fitness", cell: ({ row }) => fmtFitness(row.original.fitness) },
  { id: "dq_defects", header: "DQ defects", accessorFn: (n) => n.dq_defects ?? -1, cell: ({ row }) => <DqDefects n={row.original.dq_defects} versionId={row.original.dq_version_id} l1={l1} /> },
];

export function FlowView({ runId, doc, node, filters, onDrill, onUp }: {
  runId: string;
  doc: ProcessModelDocument;
  node: string | null;
  filters: ProcessFilterParams;
  onDrill: (id: string) => void;
  /** Moves the drill one level up; absent at the top. */
  onUp?: () => void;
}) {
  const [allEdges, setAllEdges] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const params = { ...filters, ...(node ? { node_id: node } : {}), ...(allEdges ? { all_edges: true } : {}) };
  const dfg = useQuery({ queryKey: queryKeys.processRunView(runId, "dfg", params), queryFn: () => getDfg(runId, params) });
  const pulse = usePulseOnce(JSON.stringify(params), !!dfg.data);

  if (dfg.isError) return <ErrorState {...apiErrorState(dfg.error)} onRetry={() => dfg.refetch()} />;
  if (!dfg.data) return <Skeleton height={420} />;
  const d = dfg.data;
  if (!d.nodes.length) return <EmptyState title="No activity below this step" detail="Go up one level to see its flow."
    action={onUp && <Button variant="secondary" onClick={onUp}>Go up one level</Button>} />;

  // Rank order (most cases first) fixes the Graph's keyboard order (§7.5).
  const ranked = [...d.nodes].sort((a, b) => b.case_count - a.case_count);
  const names = new Map(d.nodes.map((n) => [n.id, n.name]));
  const name = (id: string) => PSEUDO_LABEL[id] ?? names.get(id) ?? id;
  const used = new Set(d.edges.flatMap((e) => [e.source, e.target]));
  const max = Math.max(1, ...d.edges.map((e) => e.count));
  // The L1 owner module colours every node; the pulse plays for the first load only, not on filter changes.
  const ownerL1 = doc.l1.find((x) => locate({ ...doc, l1: [x] }, d.node.id));
  const owner = ownerL1?.modules[0];
  const domain = domainOf(owner);
  const orderOf = (id: string) => locate(doc, id)?.item.order;
  const bottlenecks = bottleneckKeys(d.edges);
  const reworks = new Set(d.edges.filter((e) => isRework(e, orderOf)).map((e) => `${e.source}>${e.target}`));
  const l4 = d.level === 5 ? (locate(doc, d.node.id)?.item as L4 | undefined) : undefined;
  const click = (id: string) => {
    if (PSEUDO.has(id)) return;
    if (d.level < 5) onDrill(id);
    else setOpen(id);
  };
  const edgeColumns: ColumnDef<Edge>[] = [
    { id: "from", header: "From", accessorFn: (e) => name(e.source) },
    { id: "to", header: "To", accessorFn: (e) => name(e.target) },
    { accessorKey: "count", header: "Cases", cell: ({ row }) => fmtCount(row.original.count) },
    { accessorKey: "median_seconds", header: "Median wait", cell: ({ row }) => fmtSeconds(row.original.median_seconds) },
  ];

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="m-text-meta m-ink-3">
          {allEdges ? "Every observed edge." : `Edges under ${fmtShare(d.edge_threshold)} of cases are hidden, as in the Signavio export.`}
        </span>
        <Button variant="secondary" aria-pressed={allEdges} onClick={() => setAllEdges((v) => !v)}>
          {allEdges ? "Show main edges" : "Show all edges"}
        </Button>
      </div>
      <ViewAsTable
        chart={
          <Graph legend={{ domains: [domain], bottleneck: bottlenecks.size > 0, rework: reworks.size > 0 }} title={`${d.node.name} flow`} weighted width={900} height={420}
              nodes={[...[...PSEUDO].filter((p) => used.has(p)).map((p) => ({ id: p, size: 0, label: name(p), kind: p === "START" ? ("start" as const) : ("end" as const) })),
                ...ranked.map((n) => ({ id: n.id, size: n.case_count, label: n.name, domain }))]}
              edges={d.edges.map((e) => ({ source: e.source, target: e.target, weight: e.count / max,
                bottleneck: bottlenecks.has(`${e.source}>${e.target}`) || undefined,
                rework: reworks.has(`${e.source}>${e.target}`) || undefined,
                label: e.median_seconds == null ? undefined : fmtSeconds(e.median_seconds) }))}
              pulse={pulse} onNodeClick={click} />
        }
        table={
          <div className="grid gap-3">
            <DataTable columns={nodeColumns(ownerL1?.id)} data={ranked} getRowId={(n) => n.id} onRowClick={(n) => click(n.id)}
              height="auto" hideToolbar tableId="process-flow-nodes" exportName={`process-${d.node.id}-nodes`} />
            <DataTable columns={edgeColumns} data={d.edges} getRowId={(e) => `${e.source}>${e.target}`}
              height="auto" hideToolbar tableId="process-flow-edges" exportName={`process-${d.node.id}-edges`} />
          </div>
        }
      />
      {l4 && <L5Table l4={l4} onOpen={setOpen} />}
      <L5Drawer doc={doc} id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function L5Drawer({ doc, id, onClose }: { doc: ProcessModelDocument; id: string | null; onClose: () => void }) {
  const hit = findActivity(doc, id);
  const a = hit?.act;
  const s = a?.discovery;
  const rows: [string, string][] = [
    ["Cases", fmtCount(s?.case_count ?? 0)], ["Share", fmtShare(s?.share ?? 0)],
    ["Median to next step", fmtSeconds(s?.median_seconds)], ["P90 to next step", fmtSeconds(s?.p90_seconds)],
    ["Rework", fmtShare(s?.rework_rate)], ["Automation", fmtShare(s?.automation_rate)], ["Fitness", fmtFitness(s?.fitness)],
  ];
  return (
    <Drawer open={!!a} onOpenChange={(o) => !o && onClose()} title={a?.name ?? ""} subtitle={a ? <Mono>{a.id}</Mono> : undefined}>
      {a && (
        <div className="grid gap-4">
          {!s?.observed && <p className="m-ink-3">Reference step, not observed in this run.</p>}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="m-ink-3">{k}</dt><dd className="m-numeric">{v}</dd>
              </div>
            ))}
          </dl>
          <section className="grid gap-1">
            <h2 className="font-semibold">Fields</h2>
            {a.fields.length ? (
              <ul className="grid gap-1">
                {a.fields.map((f) => (
                  <li key={f.field}><Mono>{f.field}</Mono>{f.mandatory ? ", mandatory" : ""}{f.description ? `, ${f.description}` : ""}</li>
                ))}
              </ul>
            ) : <p className="m-ink-3">No fields recorded for this step.</p>}
          </section>
        </div>
      )}
    </Drawer>
  );
}

"use client";

/**
 * Flow tab (process-discovery spec §7.3): the DFG between the children of the current node.
 * Node size is cases, edge width is count, the edge label is the median wait.
 * A node click drills one level, to L4 at most; at L4 the L5 nodes open a Drawer.
 */
import { useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, Drawer, EmptyState, ErrorState, Mono, Skeleton } from "@/design";
import { getDfg, type Dfg, type NodeStats, type ProcessFilterParams } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import type { L4, ProcessModelDocument } from "@/types/process-model";
import { findActivity, locate } from "@/app/(app)/insights/process/designer/_components/doc";
import { L5Table } from "./l5-table";
import { fmtCount, fmtFitness, fmtSeconds, fmtShare, ViewAsTable } from "./shared";

/** Lazy chunk with a fixed 420px slot so the flow does not shift when it arrives. */
const Graph = dynamic(() => import("@/design/charts/Graph").then((m) => m.Graph), {
  ssr: false, loading: () => <Skeleton height={420} />,
});

type Edge = Dfg["edges"][number];
const PSEUDO = new Set(["START", "END"]);
const PSEUDO_LABEL: Record<string, string> = { START: "Start", END: "End" };

const NODE_COLUMNS: ColumnDef<NodeStats>[] = [
  { accessorKey: "id", header: "ID", cell: ({ row }) => <Mono>{row.original.id}</Mono> },
  { accessorKey: "name", header: "Name" },
  { accessorKey: "case_count", header: "Cases", cell: ({ row }) => fmtCount(row.original.case_count) },
  { accessorKey: "share", header: "Share", cell: ({ row }) => fmtShare(row.original.share) },
  { accessorKey: "median_seconds", header: "Median", cell: ({ row }) => fmtSeconds(row.original.median_seconds) },
  { accessorKey: "fitness", header: "Fitness", cell: ({ row }) => fmtFitness(row.original.fitness) },
];

export function FlowView({ runId, doc, node, filters, onDrill }: {
  runId: string;
  doc: ProcessModelDocument;
  node: string | null;
  filters: ProcessFilterParams;
  onDrill: (id: string) => void;
}) {
  const [allEdges, setAllEdges] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const params = { ...filters, ...(node ? { node_id: node } : {}), ...(allEdges ? { all_edges: true } : {}) };
  const dfg = useQuery({ queryKey: queryKeys.processRunView(runId, "dfg", params), queryFn: () => getDfg(runId, params) });

  if (dfg.isError) return <ErrorState message={apiErrorMessage(dfg.error)} onRetry={() => dfg.refetch()} />;
  if (!dfg.data) return <Skeleton height={420} />;
  const d = dfg.data;
  if (!d.nodes.length) return <EmptyState title="No activity below this step" detail="Go up one level to see its flow." />;

  // Rank order (most cases first) fixes the Graph's keyboard order (§7.5).
  const ranked = [...d.nodes].sort((a, b) => b.case_count - a.case_count);
  const names = new Map(d.nodes.map((n) => [n.id, n.name]));
  const name = (id: string) => PSEUDO_LABEL[id] ?? names.get(id) ?? id;
  const used = new Set(d.edges.flatMap((e) => [e.source, e.target]));
  const max = Math.max(1, ...d.edges.map((e) => e.count));
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
        <span className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>
          {allEdges ? "Every observed edge." : `Edges under ${fmtShare(d.edge_threshold)} of cases are hidden, as in the Signavio export.`}
        </span>
        <Button variant="secondary" aria-pressed={allEdges} onClick={() => setAllEdges((v) => !v)}>
          {allEdges ? "Show main edges" : "Show all edges"}
        </Button>
      </div>
      <ViewAsTable
        chart={
          <div className="overflow-x-auto">
            <Graph title={`${d.node.name} flow`} weighted width={900} height={420}
              nodes={[...[...PSEUDO].filter((p) => used.has(p)).map((p) => ({ id: p, size: 0, label: name(p) })),
                ...ranked.map((n) => ({ id: n.id, size: n.case_count, label: n.name }))]}
              edges={d.edges.map((e) => ({ source: e.source, target: e.target, weight: e.count / max,
                label: e.median_seconds == null ? undefined : fmtSeconds(e.median_seconds) }))}
              onNodeClick={click} />
          </div>
        }
        table={
          <div className="grid gap-3">
            <DataTable columns={NODE_COLUMNS} data={ranked} getRowId={(n) => n.id} onRowClick={(n) => click(n.id)}
              height="auto" hideToolbar dense tableId="process-flow-nodes" exportName={`process-${d.node.id}-nodes`} />
            <DataTable columns={edgeColumns} data={d.edges} getRowId={(e) => `${e.source}>${e.target}`}
              height="auto" hideToolbar dense tableId="process-flow-edges" exportName={`process-${d.node.id}-edges`} />
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
          {!s?.observed && <p style={{ color: "var(--m-ink-3)" }}>Reference step, not observed in this run.</p>}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt style={{ color: "var(--m-ink-3)" }}>{k}</dt><dd className="m-numeric">{v}</dd>
              </div>
            ))}
          </dl>
          <section className="grid gap-1">
            <h2 className="font-semibold">Fields</h2>
            {a.fields.length ? (
              <ul className="grid gap-1">
                {a.fields.map((f) => (
                  <li key={f.field}><Mono>{f.field}</Mono>{f.mandatory ? " · mandatory" : ""}{f.description ? ` · ${f.description}` : ""}</li>
                ))}
              </ul>
            ) : <p style={{ color: "var(--m-ink-3)" }}>No fields recorded for this step.</p>}
          </section>
        </div>
      )}
    </Drawer>
  );
}

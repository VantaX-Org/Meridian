"use client";

/**
 * Conformance tab (process-discovery spec §7.3): case-type fitness, the Paretos of missing and
 * out-of-order steps, and the per-step table. Rework comes from the run's unfiltered stats.
 */
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, EmptyState, ErrorState, Notice, Pareto, Skeleton, Stat } from "@/design";
import { getConformance, type Conformance, type ProcessFilterParams } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { fitnessTone, fmtFitness, fmtShare, ViewAsTable } from "./shared";

type Step = Conformance["steps"][number] & { missing: number; rework: number | undefined };
type Point = { x: string; y: number };

const POINT_COLUMNS: ColumnDef<Point>[] = [
  { accessorKey: "x", header: "Step" },
  { accessorKey: "y", header: "Share of cases", cell: ({ row }) => fmtShare(row.original.y) },
];

function ParetoPanel({ title, data, id }: { title: string; data: Point[]; id: string }) {
  return (
    <section className="grid gap-2">
      <h3 className="font-semibold">{title}</h3>
      {data.length ? (
        <ViewAsTable
          chart={<Pareto data={data} height={220} />}
          table={<DataTable columns={POINT_COLUMNS} data={data} getRowId={(p) => p.x} height="auto" hideToolbar dense
            tableId={id} exportName={id} />} />
      ) : <p style={{ color: "var(--m-ink-3)" }}>None in this view.</p>}
    </section>
  );
}

export function ConformanceView({ runId, l1, filters, rework }: {
  runId: string;
  l1: string;
  filters: ProcessFilterParams;
  rework: Record<string, number> | undefined;
}) {
  const q = useQuery({ queryKey: queryKeys.processRunView(runId, "conformance", filters), queryFn: () => getConformance(runId, filters) });
  if (q.isError) return <ErrorState message={apiErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton height={320} />;
  const c = q.data;
  if (!c.steps.length) return <EmptyState title="No cases to check in this view" detail="Widen the filters to include more cases." />;

  const tone = fitnessTone(c.fitness);
  const steps: Step[] = c.steps.map((s) => ({ ...s, missing: c.missing[s.activity] ?? 0, rework: rework?.[s.activity] }));
  const columns: ColumnDef<Step>[] = [
    { accessorKey: "activity", header: "Step" },
    { accessorKey: "step_fitness", header: "Step fitness", cell: ({ row }) => fmtFitness(row.original.step_fitness) },
    { accessorKey: "missing", header: "Missing", cell: ({ row }) => fmtShare(row.original.missing) },
    { accessorKey: "out_of_order", header: "Out of order", cell: ({ row }) => fmtShare(row.original.out_of_order) },
    { id: "rework", header: "Rework", accessorFn: (s) => s.rework ?? -1, cell: ({ row }) => fmtShare(row.original.rework) },
  ];

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Fitness" value={fmtFitness(c.fitness)} tone={tone === "go" || tone === "at-risk" || tone === "no-go" ? tone : undefined}
          hint="Share of reference steps each case performs in order" />
      </div>
      {l1 === "SFX" && (
        <Notice tone="info" title="Rework is not measured for SuccessFactors">
          Each application keeps only its latest status, so a repeated step leaves no trace.
        </Notice>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <ParetoPanel title="Missing steps" id="process-missing"
          data={Object.entries(c.missing).map(([x, y]) => ({ x, y }))} />
        <ParetoPanel title="Out-of-order steps" id="process-out-of-order"
          data={c.steps.filter((s) => s.out_of_order > 0).map((s) => ({ x: s.activity, y: s.out_of_order }))} />
      </div>
      <DataTable columns={columns} data={steps} getRowId={(s) => s.activity} height="auto" dense
        tableId="process-conformance-steps" exportName={`process-conformance-${runId}`} />
    </div>
  );
}

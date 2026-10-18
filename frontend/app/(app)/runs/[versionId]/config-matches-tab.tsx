"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, EmptyState, ErrorState, Mono, Pill, Skeleton, Stat, type PillTone } from "@/design";
import { exportConfigMatches, getConfigMatches, type ConfigMatch } from "@/lib/api/config-matches";
import { useRole } from "@/hooks/use-role";
import { isNotFound, apiErrorState } from "@/lib/error";
import { formatModuleName, labelOf } from "@/lib/format";

const dash = (v: string | number | null) => v ?? "—";
const CLASS_TONE: Record<string, PillTone> = { config_driven: "go", data_error: "no-go", mismatch: "at-risk" };

/** Runs/[v] › Config matches: where live configuration disagrees with the standard rule. Export needs `export`. */
export function ConfigMatchesTab({ versionId }: { versionId: string }) {
  const { can } = useRole();
  const q = useQuery({ queryKey: ["config-matches", versionId], queryFn: () => getConfigMatches(versionId), retry: false });
  const cols = useMemo<ColumnDef<ConfigMatch, unknown>[]>(() => [
    { id: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "check", header: "Check", cell: ({ row }) => <Mono>{row.original.check_id}</Mono> },
    { id: "record", header: "Record", cell: ({ row }) => <Mono>{dash(row.original.record_key)}</Mono> },
    { id: "field", header: "Field", cell: ({ row }) => dash(row.original.field) },
    { id: "actual", header: "Actual", cell: ({ row }) => <Mono>{dash(row.original.actual_value)}</Mono> },
    { id: "expected", header: "Standard expects", cell: ({ row }) => dash(row.original.std_rule_expectation) },
    { id: "class", header: "Classification", cell: ({ row }) => <Pill tone={CLASS_TONE[row.original.classification] ?? "neutral"}>{labelOf(row.original.classification)}</Pill> },
    { id: "action", header: "Recommended action", cell: ({ row }) => dash(row.original.recommended_action) },
    { id: "tcode", header: "T-code", cell: ({ row }) => <Mono>{dash(row.original.sap_tcode)}</Mono> },
    { id: "prio", header: "Priority", cell: ({ row }) => dash(row.original.fix_priority) },
  ], []);

  if (q.isLoading) return <Skeleton height={240} />;
  if (q.error && !isNotFound(q.error)) return <ErrorState {...apiErrorState(q.error)} onRetry={() => q.refetch()} />;
  const items = q.data?.items ?? [];
  if (items.length === 0) {
    return <EmptyState title="No config matches for this run." detail="They appear when an analysis includes the config intelligence engine." />;
  }
  const byClass = items.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.classification]: (acc[m.classification] ?? 0) + 1 }), {});
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-6">
        <Stat label="Config matches" value={items.length.toLocaleString()} />
        {Object.entries(byClass).map(([k, v]) => <Stat key={k} label={labelOf(k)} value={v.toLocaleString()} />)}
      </div>
      <DataTable columns={cols} data={items} getRowId={(m) => `${m.module}/${m.check_id}/${m.record_key ?? ""}/${m.field ?? ""}`}
        height={440} exportName={`config-matches-${versionId}`}
        exportOptions={can("export") ? [{ format: "xlsx", label: "Config matches (.xlsx)", run: () => exportConfigMatches(versionId) }] : undefined} />
    </div>
  );
}

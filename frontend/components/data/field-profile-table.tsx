"use client";

/**
 * The field profile of one analysed run: per table, per field, how full it is,
 * how many distinct values it holds and what range they span. Plus the hidden
 * rule candidates mined from the same data, which can be accepted as checks.
 */

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, DataTable, type AuroraColumnMeta } from "@/components/aurora";
import { EmptyState, FieldChip, SectionCard, StatusBadge, type Status } from "@/components/ui-core";
import { acceptDependency, type FieldDependency, type FieldProfile, type FieldStats, type TableProfile, type VersionProfile } from "@/lib/api/field-profile";
import { useRole } from "@/hooks/use-role";

const meta = (m: AuroraColumnMeta) => m;
const n = (v: number) => v.toLocaleString();

function range(s: FieldStats): string {
  if (s.numeric && s.numeric.min !== null && s.numeric.max !== null) return `${n(s.numeric.min)} to ${n(s.numeric.max)}`;
  if (s.dates?.min && s.dates.max) return `${s.dates.min} to ${s.dates.max}`;
  return "";
}

function fieldStatus(s: FieldStats): { status: Status; label: string } {
  if (s.mask_reason === "privacy") return { status: "idle", label: "Masked, personal data" };
  if (s.rows > 0 && s.blank >= s.rows) return { status: "high", label: "Empty" };
  if (s.numeric?.non_numeric) return { status: "medium", label: "Non-numeric values" };
  if (s.dates?.invalid) return { status: "medium", label: "Invalid dates" };
  if (s.blank > 0) return { status: "low", label: "Partly blank" };
  return { status: "ok", label: "Complete" };
}

function columns(table: string): ColumnDef<FieldProfile, unknown>[] {
  return [
    { id: "field", header: "Field", meta: meta({ sticky: "start", width: 200 }),
      cell: ({ row }) => <FieldChip table={table} field={row.original.field} /> },
    { id: "type", header: "Type", meta: meta({ width: 90 }),
      cell: ({ row }) => row.original.stats.ddic_type ? `${row.original.stats.ddic_type} ${row.original.stats.ddic_length ?? ""}` : "" },
    { id: "fill", header: "Filled", meta: meta({ width: 170 }),
      cell: ({ row }) => {
        const fill = Math.max(0, Math.min(100, 100 - row.original.stats.blank_pct));
        return (
          <span className="ui-fill" title={`${n(row.original.stats.rows - row.original.stats.blank)} of ${n(row.original.stats.rows)} filled`}>
            <span className="ui-fill__bar"><span style={{ transform: `scaleX(${fill / 100})` }} /></span>
            <span className="ui-fill__num">{fill.toFixed(1)}%</span>
          </span>
        );
      } },
    { id: "blank", header: "Blank", meta: meta({ width: 90, numeric: true, align: "end" }), cell: ({ row }) => n(row.original.stats.blank) },
    { id: "distinct", header: "Distinct", meta: meta({ width: 100, numeric: true, align: "end" }), cell: ({ row }) => n(row.original.stats.distinct) },
    { id: "range", header: "Min and max", meta: meta({ minWidth: 200, numeric: true }), cell: ({ row }) => range(row.original.stats) },
    { id: "status", header: "Status", meta: meta({ width: 180 }),
      cell: ({ row }) => { const s = fieldStatus(row.original.stats); return <StatusBadge status={s.status}>{s.label}</StatusBadge>; } },
  ];
}

function TableSection({ table }: { table: TableProfile }) {
  const cols = useMemo(() => columns(table.table), [table.table]);
  return (
    <SectionCard title={table.table} flush
      meta={`${table.sampled ? `first ${n(table.rows)} of ${n(table.table_rows)} records` : `${n(table.rows)} records`}, ${table.fields.length} fields`}>
      <DataTable<FieldProfile> ariaLabel={`Fields of ${table.table}`} columns={cols} data={table.fields}
        getRowId={(f) => f.field} maxHeight={420} />
    </SectionCard>
  );
}

export function FieldProfileTable({ profile, object }: { profile: VersionProfile; object?: string }) {
  const sampled = profile.tables.filter((t) => t.sampled);
  if (!profile.tables.length) {
    return <EmptyState>No profile for this run. Profiles are built during extraction.</EmptyState>;
  }
  return (
    <div className="ui-stack" data-object={object}>
      {sampled.length ? (
        <p className="ui-note">
          Large tables ({sampled.map((t) => t.table).join(", ")}) were profiled on their first records. The checks ran on every record.
        </p>
      ) : null}
      {profile.tables.map((t) => <TableSection key={t.table} table={t} />)}
    </div>
  );
}

/** Candidate rules: one field decides another for at least 99 percent of records. Accepting one adds a check. */
export function HiddenRules({ deps, module }: { deps: FieldDependency[]; module: string | null }) {
  const qc = useQueryClient();
  const canAccept = useRole().can("manage_rules") && !!module;
  const accept = useMutation({
    mutationFn: (d: FieldDependency) => acceptDependency({ module: module ?? "", determinant: d.determinant, dependent: d.dependent }),
    onSuccess: (r) => { toast.success(`${r.name.split(":")[0]} added. It runs on the next analysis.`); void qc.invalidateQueries({ queryKey: ["version-profile"] }); },
    onError: () => toast.error("Could not add the check"),
  });
  const cols = useMemo<ColumnDef<FieldDependency, unknown>[]>(() => [
    { id: "rule", header: "Rule", meta: meta({ minWidth: 280 }),
      cell: ({ row }) => <span><FieldChip field={row.original.determinant} /> decides <FieldChip field={row.original.dependent} /></span> },
    { id: "holds", header: "Holds for", meta: meta({ width: 110, numeric: true, align: "end" }), cell: ({ row }) => `${(row.original.support * 100).toFixed(2)}%` },
    { id: "bad", header: "Disagree", meta: meta({ width: 110, numeric: true, align: "end" }), cell: ({ row }) => n(row.original.violations) },
    { id: "keys", header: "Sample records", meta: meta({ minWidth: 200 }), cell: ({ row }) => row.original.sample_keys.join(", ") },
    { id: "act", header: "", meta: meta({ width: 150, align: "end" }),
      cell: ({ row }) => row.original.accepted ? <StatusBadge status="ok">Check</StatusBadge>
        : canAccept ? <Button size="sm" variant="ghost" disabled={accept.isPending} onClick={() => accept.mutate(row.original)}>Accept as check</Button> : null },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canAccept, accept.isPending]);
  return (
    <SectionCard title="Hidden rules" meta={deps.length || undefined} flush>
      {deps.length ? <DataTable<FieldDependency> ariaLabel="Hidden rule candidates" columns={cols} data={deps}
        getRowId={(d) => `${d.determinant}>${d.dependent}`} maxHeight={360} />
        : <EmptyState>No candidate rules in this object&apos;s data.</EmptyState>}
    </SectionCard>
  );
}

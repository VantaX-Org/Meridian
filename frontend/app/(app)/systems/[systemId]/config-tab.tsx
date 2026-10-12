"use client";

import { useMemo, type ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Card, DataTable, EmptyState, ErrorState, Mono, Pill, Skeleton, Stat, Tabs, type PillTone } from "@/design";
import {
  getConfigAlignment, getConfigDrift, getConfigGhost, getConfigHealth, getConfigInventory, getConfigLicence,
  getConfigProcesses, getConfigShadow,
  type AlignmentFinding, type ConfigDriftEntry, type ConfigElement, type ConfigHealthScore, type LicenceUtilisation, type ProcessHealth,
} from "@/lib/api/config-intelligence";
import { apiErrorMessage, isNotFound } from "@/lib/error";
import { formatModuleName, labelOf } from "@/lib/format";
import { ConfigComparePanel } from "./config-compare-panel";

const SEVERITY_TONE: Record<string, PillTone> = { critical: "no-go", high: "no-go", medium: "at-risk", low: "neutral" };
const STATUS_TONE: Record<string, PillTone> = { active: "go", partial: "at-risk", dormant: "at-risk", inactive: "no-go", ghost: "no-go" };
const n = (v: number) => v.toLocaleString();
const dash = (v: string | null | undefined) => v ?? "—";
const note = { color: "var(--m-ink-2)" };

/** One config-intelligence list: loading, 404 (no analysis yet) as an honest empty state, error, then the body. */
function Feed<T>({ q, empty, children }: { q: UseQueryResult<T>; empty: string; children: (data: T) => ReactNode }) {
  if (q.isLoading) return <Skeleton height={200} />;
  if (q.error && isNotFound(q.error)) {
    return <EmptyState title="No configuration analysis yet." detail={`${empty} Run an analysis to populate it.`} />;
  }
  if (q.error) return <ErrorState message={apiErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  return <>{q.data ? children(q.data) : null}</>;
}

function useCfg<T>(key: string, fn: () => Promise<T>) {
  return useQuery({ queryKey: ["config-intelligence", key], queryFn: fn, retry: false });
}

function HealthSection() {
  const q = useCfg("health", getConfigHealth);
  const cols = useMemo<ColumnDef<ConfigHealthScore, unknown>[]>(() => [
    { id: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "chs", header: "Config health", cell: ({ row }) => row.original.chs.toFixed(1) },
    { id: "critical", header: "Critical", cell: ({ row }) => n(row.original.critical_count) },
    { id: "high", header: "High", cell: ({ row }) => n(row.original.high_count) },
    { id: "medium", header: "Medium", cell: ({ row }) => n(row.original.medium_count) },
    { id: "low", header: "Low", cell: ({ row }) => n(row.original.low_count) },
  ], []);
  return (
    <Feed q={q} empty="Config health scores each module's configuration.">
      {(d) => d.scores.length === 0
        ? <EmptyState title="No module scored yet." />
        : <DataTable columns={cols} data={d.scores} getRowId={(s) => s.module} height={360} exportName="config-health" />}
    </Feed>
  );
}

function InventorySection() {
  const q = useCfg("inventory", getConfigInventory);
  const cols = useMemo<ColumnDef<ConfigElement, unknown>[]>(() => [
    { id: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "type", header: "Element", cell: ({ row }) => labelOf(row.original.element_type) },
    { id: "value", header: "Value", cell: ({ row }) => <Mono>{row.original.element_value}</Mono> },
    { id: "tx", header: "Transactions", cell: ({ row }) => n(row.original.transaction_count) },
    { id: "last", header: "Last seen", cell: ({ row }) => dash(row.original.last_seen) },
    { id: "status", header: "Status", cell: ({ row }) => <Pill tone={STATUS_TONE[row.original.status] ?? "neutral"}>{labelOf(row.original.status)}</Pill> },
    { id: "table", header: "SAP table", cell: ({ row }) => <Mono>{row.original.sap_reference_table}</Mono> },
  ], []);
  return (
    <Feed q={q} empty="The inventory lists the configuration values seen in transactions.">
      {(d) => d.elements.length === 0
        ? <EmptyState title="No configuration elements discovered." />
        : <DataTable columns={cols} data={d.elements} getRowId={(e) => `${e.module}/${e.element_type}/${e.element_value}`} height={420} exportName="config-inventory" />}
    </Feed>
  );
}

function ProcessesSection() {
  const q = useCfg("processes", getConfigProcesses);
  const cols = useMemo<ColumnDef<ProcessHealth, unknown>[]>(() => [
    { id: "name", header: "Process", cell: ({ row }) => row.original.process_name },
    { id: "status", header: "Status", cell: ({ row }) => <Pill tone={STATUS_TONE[row.original.status] ?? "neutral"}>{labelOf(row.original.status)}</Pill> },
    { id: "complete", header: "Completeness", cell: ({ row }) => `${Math.round(row.original.completeness_score * 100)}%` },
    { id: "volume", header: "Volume", cell: ({ row }) => n(row.original.total_volume) },
    { id: "exc", header: "Exception rate", cell: ({ row }) => `${(row.original.exception_rate * 100).toFixed(1)}%` },
    { id: "cycle", header: "Cycle (days)", cell: ({ row }) => row.original.avg_cycle_days?.toFixed(1) ?? "—" },
    { id: "bottleneck", header: "Bottleneck", cell: ({ row }) => dash(row.original.bottleneck_step) },
  ], []);
  return (
    <Feed q={q} empty="Process health traces each process step through its SAP tables.">
      {(d) => d.processes.length === 0 ? <EmptyState title="No processes detected." /> : (
        <DataTable columns={cols} data={d.processes} getRowId={(p) => p.process_id} height={360} exportName="config-processes"
          renderDrawer={(p) => (
            <ol className="flex flex-col gap-2 m-text-body">
              {p.steps.map((s) => (
                <li key={s.step_number} className="flex items-center justify-between gap-3">
                  <span>{s.step_number}. {s.step_name} <Mono>{s.sap_table}</Mono></span>
                  <span>{s.detected ? `${n(s.volume)} records, ${n(s.exception_count)} exceptions` : <Pill tone="no-go">Not detected</Pill>}</span>
                </li>
              ))}
            </ol>
          )} />
      )}
    </Feed>
  );
}

function findingCols(): ColumnDef<AlignmentFinding, unknown>[] {
  return [
    { id: "check", header: "Check", cell: ({ row }) => <Mono>{row.original.check_id}</Mono> },
    { id: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "category", header: "Category", cell: ({ row }) => labelOf(row.original.category) },
    { id: "severity", header: "Severity", cell: ({ row }) => <Pill tone={SEVERITY_TONE[row.original.severity] ?? "neutral"}>{labelOf(row.original.severity)}</Pill> },
    { id: "title", header: "Finding", cell: ({ row }) => row.original.title },
    { id: "impact", header: "Impact (ZAR)", cell: ({ row }) => n(Math.round(row.original.estimated_impact_zar)) },
  ];
}

function FindingsTable({ rows, name }: { rows: AlignmentFinding[]; name: string }) {
  const cols = useMemo(() => findingCols(), []);
  if (rows.length === 0) return <EmptyState title="Nothing found." />;
  return (
    <DataTable columns={cols} data={rows} getRowId={(f) => `${f.check_id}/${f.module}/${f.title}`} height={380} exportName={name}
      renderDrawer={(f) => (
        <div className="flex flex-col gap-2 m-text-body">
          <p>{f.description}</p>
          {f.remediation ? <p style={note}>Remediation: {f.remediation}</p> : null}
          {f.affected_elements.length ? <p style={note}>Affected: {f.affected_elements.join(", ")}</p> : null}
        </div>
      )} />
  );
}

function AlignmentSection() {
  const q = useCfg("alignment", getConfigAlignment);
  return <Feed q={q} empty="Alignment compares configuration with how it is used.">{(d) => <FindingsTable rows={d.findings} name="config-alignment" />}</Feed>;
}

function GhostShadowSection() {
  const ghost = useCfg("ghost", getConfigGhost);
  const shadow = useCfg("shadow", getConfigShadow);
  return (
    <div className="flex flex-col gap-4">
      <Card title="Ghost configuration" meta="Configured in SAP but never used in a transaction.">
        <Feed q={ghost} empty="Ghost configuration is configured but unused.">{(d) => <FindingsTable rows={d.findings} name="config-ghost" />}</Feed>
      </Card>
      <Card title="Shadow configuration" meta="Used in transactions but missing from the configuration.">
        <Feed q={shadow} empty="Shadow configuration is used but not configured.">{(d) => <FindingsTable rows={d.findings} name="config-shadow" />}</Feed>
      </Card>
    </div>
  );
}

function DriftSection() {
  const q = useCfg("drift", getConfigDrift);
  const cols = useMemo<ColumnDef<ConfigDriftEntry, unknown>[]>(() => [
    { id: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "type", header: "Element", cell: ({ row }) => labelOf(row.original.element_type) },
    { id: "value", header: "Value", cell: ({ row }) => <Mono>{row.original.element_value}</Mono> },
    { id: "change", header: "Change", cell: ({ row }) => <Pill>{labelOf(row.original.change_type)}</Pill> },
  ], []);
  return (
    <Feed q={q} empty="Drift needs two runs to compare.">
      {(d) => d.drift_entries.length === 0 ? <EmptyState title="No drift between the last two runs." /> : (
        <DataTable columns={cols} data={d.drift_entries} getRowId={(e) => `${e.module}/${e.element_type}/${e.element_value}`} height={380} exportName="config-drift"
          renderDrawer={(e) => (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 m-text-body">
              <dt style={note}>Previous run</dt><dd><Mono>{d.previous_run_id}</Mono></dd>
              <dt style={note}>Current run</dt><dd><Mono>{d.current_run_id}</Mono></dd>
              <dt style={note}>Previous value</dt><dd><Mono>{dash(e.previous_value)}</Mono></dd>
              <dt style={note}>Current value</dt><dd><Mono>{dash(e.current_value)}</Mono></dd>
            </dl>
          )} />
      )}
    </Feed>
  );
}

function LicenceSection() {
  const q = useCfg("licence", getConfigLicence);
  const cols = useMemo<ColumnDef<LicenceUtilisation, unknown>[]>(() => [
    { id: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "elements", header: "Config elements", cell: ({ row }) => n(row.original.total_config_elements) },
    { id: "tx", header: "Transactions", cell: ({ row }) => n(row.original.total_transactions) },
    { id: "util", header: "Utilisation", cell: ({ row }) => `${row.original.utilisation_pct.toFixed(1)}%` },
    { id: "status", header: "Status", cell: ({ row }) => <Pill tone={STATUS_TONE[row.original.status] ?? "neutral"}>{labelOf(row.original.status)}</Pill> },
  ], []);
  return (
    <Feed q={q} empty="Licence utilisation compares configured modules with the transactions they carry.">
      {(d) => d.modules.length === 0 ? <EmptyState title="No module utilisation yet." /> : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-6">
            <Stat label="Modules" value={d.modules.length} />
            <Stat label="Under-used" value={d.modules.filter((m) => m.utilisation_pct < 25).length} />
          </div>
          <DataTable columns={cols} data={d.modules} getRowId={(m) => m.module} height={320} exportName="licence-utilisation" />
        </div>
      )}
    </Feed>
  );
}

/** Systems/[id] › Configuration. The analysis behind it is tenant-wide, so the header says so. */
export function ConfigurationTab({ systemId, canPropose }: { systemId: string; canPropose: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="m-text-body" style={note}>Configuration analysis covers every connected system in this workspace, from the latest run.</p>
      <Tabs
        items={[
          { value: "health", label: "Health", content: <HealthSection /> },
          { value: "inventory", label: "Inventory", content: <InventorySection /> },
          { value: "processes", label: "Processes", content: <ProcessesSection /> },
          { value: "alignment", label: "Alignment", content: <AlignmentSection /> },
          { value: "ghost", label: "Ghost and shadow", content: <GhostShadowSection /> },
          { value: "drift", label: "Drift", content: <DriftSection /> },
          { value: "licence", label: "Licence use", content: <LicenceSection /> },
          { value: "compare", label: "Compare", content: <ConfigComparePanel systemId={systemId} canPropose={canPropose} /> },
        ]}
      />
    </div>
  );
}

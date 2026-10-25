"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { AnalyseAction } from "./analyse-action";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, EmptyState, ErrorState, Mono, Pill, Score, Skeleton, Tabs, type PillTone, Status } from "@/design";
import { useRole } from "@/hooks/use-role";
import {
  discoverConfigNow, getConfigAlignment, getConfigDrift, getConfigGhost, getConfigHealth, getConfigInventory, getConfigLicence,
  getConfigProcesses, getConfigShadow,
  type AlignmentFinding, type ConfigDriftEntry, type ConfigElement, type ConfigHealthScore, type LicenceUtilisation, type ProcessHealth,
} from "@/lib/api/config-intelligence";
import { isNotFound, apiErrorState } from "@/lib/error";
import { formatModuleName, labelOf } from "@/lib/format";
import { ConfigComparePanel } from "./config-compare-panel";
import { AlignmentModuleDrawer, InventoryModuleDrawer } from "./config-module-drawers";
import { useRerun } from "./use-rerun";
import { useRowDrawer } from "./row-drawer";

const STATUS_TONE: Record<string, PillTone> = { active: "go", partial: "at-risk", dormant: "at-risk", inactive: "no-go", ghost: "no-go" };
const n = (v: number) => v.toLocaleString();
const dash = (v: string | null | undefined) => v ?? "—";
const analyseAction = <AnalyseAction />;

/** One config-intelligence list: loading, 404 (no analysis yet) as an honest empty state, error, then the body. */
function Feed<T>({ q, empty, children }: { q: UseQueryResult<T>; empty: string; children: (data: T) => ReactNode }) {
  if (q.isLoading) return <Skeleton height={200} />;
  if (q.error && isNotFound(q.error)) {
    return <EmptyState title="No configuration analysis yet" detail={empty} action={analyseAction} />;
  }
  if (q.error) return <ErrorState {...apiErrorState(q.error)} onRetry={() => q.refetch()} />;
  return <>{q.data ? children(q.data) : null}</>;
}

function useCfg<T>(key: string, fn: () => Promise<T>) {
  return useQuery({ queryKey: ["config-intelligence", key], queryFn: fn, retry: false });
}

function HealthSection() {
  const q = useCfg("health", getConfigHealth);
  const [moduleOpen, setModuleOpen] = useState<string | null>(null);
  const cols = useMemo<ColumnDef<ConfigHealthScore, unknown>[]>(() => [
    { id: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "chs", header: "Config health", cell: ({ row }) => <Score size="sm" value={row.original.chs} /> },
    { id: "critical", header: "Critical", cell: ({ row }) => n(row.original.critical_count) },
    { id: "high", header: "High", cell: ({ row }) => n(row.original.high_count) },
    { id: "medium", header: "Medium", cell: ({ row }) => n(row.original.medium_count) },
    { id: "low", header: "Low", cell: ({ row }) => n(row.original.low_count) },
    { id: "open", header: "", size: 80, cell: ({ row }) => (
      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setModuleOpen(row.original.module); }}>Open</Button>
    ) },
  ], []);
  return (
    <Feed q={q} empty="Config health scores each module's configuration.">
      {(d) => d.scores.length === 0
        ? <EmptyState title="No module scored yet" detail="Scores appear once a run has been analysed." action={analyseAction} />
        : (
          <>
            <DataTable columns={cols} data={[...d.scores].sort((a, b) => a.chs - b.chs)} getRowId={(s) => s.module} height={360} exportName="config-health" onRowClick={(s) => setModuleOpen(s.module)} />
            <AlignmentModuleDrawer module={moduleOpen} onClose={() => setModuleOpen(null)} />
          </>
        )}
    </Feed>
  );
}

interface ModuleCounts { module: string; total: number; active: number; dormant: number; ghost: number }

function InventorySection() {
  const q = useCfg("inventory", getConfigInventory);
  const [moduleOpen, setModuleOpen] = useState<string | null>(null);
  const moduleCols = useMemo<ColumnDef<ModuleCounts, unknown>[]>(() => [
    { id: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "total", header: "Elements", cell: ({ row }) => n(row.original.total) },
    { id: "active", header: "Active", cell: ({ row }) => n(row.original.active) },
    { id: "dormant", header: "Dormant", cell: ({ row }) => n(row.original.dormant) },
    { id: "ghost", header: "Ghost", cell: ({ row }) => n(row.original.ghost) },
    { id: "open", header: "", size: 80, cell: ({ row }) => (
      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setModuleOpen(row.original.module); }}>Open</Button>
    ) },
  ], []);
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
      {(d) => {
        if (d.elements.length === 0) return <EmptyState title="No configuration elements discovered" detail="The inventory fills from analysed transactions." action={analyseAction} />;
        const byModule = new Map<string, ModuleCounts>();
        for (const e of d.elements) {
          const c = byModule.get(e.module) ?? { module: e.module, total: 0, active: 0, dormant: 0, ghost: 0 };
          c.total += 1;
          c[e.status] += 1;
          byModule.set(e.module, c);
        }
        return (
          <div className="flex flex-col gap-4">
            <Card title="By module" meta="All systems; select a module for its elements">
              <DataTable columns={moduleCols} data={[...byModule.values()]} getRowId={(m) => m.module} onRowClick={(m) => setModuleOpen(m.module)} hideToolbar dense height="auto" tableId="config-inventory-modules" />
            </Card>
            <DataTable columns={cols} data={d.elements} getRowId={(e) => `${e.module}/${e.element_type}/${e.element_value}`} height={420} exportName="config-inventory" />
            <InventoryModuleDrawer module={moduleOpen} onClose={() => setModuleOpen(null)} />
          </div>
        );
      }}
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
  const { open, drawer, column } = useRowDrawer<ProcessHealth>("Process steps", (p) => (
    <ol className="flex flex-col gap-2 m-text-body">
      {p.steps.map((s) => (
        <li key={s.step_number} className="flex items-center justify-between gap-3">
          <span>{s.step_number}. {s.step_name} <Mono>{s.sap_table}</Mono></span>
          <span>{s.detected ? `${n(s.volume)} records, ${n(s.exception_count)} exceptions` : <Pill tone="no-go">Not detected</Pill>}</span>
        </li>
      ))}
    </ol>
  ));
  const withOpen = useMemo(() => [...cols, column], [cols, column]);
  return (
    <Feed q={q} empty="Process health traces each process step through its SAP tables.">
      {(d) => d.processes.length === 0 ? <EmptyState title="No processes detected" detail="Processes are traced from analysed transactions." action={analyseAction} /> : (
        <>
          <DataTable columns={withOpen} data={d.processes} getRowId={(p) => p.process_id} height={360} exportName="config-processes" onRowClick={open} />
          {drawer}
        </>
      )}
    </Feed>
  );
}

function findingCols(): ColumnDef<AlignmentFinding, unknown>[] {
  return [
    { id: "check", header: "Check", cell: ({ row }) => <Mono>{row.original.check_id}</Mono> },
    { id: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "category", header: "Category", cell: ({ row }) => labelOf(row.original.category) },
    { id: "severity", header: "Severity", cell: ({ row }) => <Status kind="severity" value={row.original.severity} /> },
    { id: "title", header: "Finding", cell: ({ row }) => row.original.title },
    { id: "impact", header: "Impact (ZAR)", cell: ({ row }) => n(Math.round(row.original.estimated_impact_zar)) },
  ];
}

function FindingsTable({ rows, name }: { rows: AlignmentFinding[]; name: string }) {
  const { open, drawer, column } = useRowDrawer<AlignmentFinding>("Finding", (f) => (
    <div className="flex flex-col gap-2 m-text-body">
      <p>{f.description}</p>
      {f.remediation ? <p className="m-ink-2">Remediation: {f.remediation}</p> : null}
      {f.affected_elements.length ? <p className="m-ink-2">Affected: {f.affected_elements.join(", ")}</p> : null}
    </div>
  ));
  const cols = useMemo(() => [...findingCols(), column], [column]);
  const ranked = useMemo(() => [...rows].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.estimated_impact_zar - a.estimated_impact_zar), [rows]);
  if (rows.length === 0) return <EmptyState title="Nothing found" detail="The latest analysis raised no findings here." action={analyseAction} />;
  return (
    <>
      <DataTable columns={cols} data={ranked} getRowId={(f) => `${f.check_id}/${f.module}/${f.title}`} height={380} exportName={name} onRowClick={open} />
      {drawer}
    </>
  );
}

interface ModuleFindings { module: string; total: number; worst: string }
const SEVERITY_ORDER = ["critical", "high", "medium", "low"];

function AlignmentSection() {
  const q = useCfg("alignment", getConfigAlignment);
  const [moduleOpen, setModuleOpen] = useState<string | null>(null);
  const moduleCols = useMemo<ColumnDef<ModuleFindings, unknown>[]>(() => [
    { id: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "total", header: "Findings", cell: ({ row }) => n(row.original.total) },
    { id: "worst", header: "Worst severity", cell: ({ row }) => <Status kind="severity" value={row.original.worst} /> },
    { id: "open", header: "", size: 80, cell: ({ row }) => (
      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setModuleOpen(row.original.module); }}>Open</Button>
    ) },
  ], []);
  return (
    <Feed q={q} empty="Alignment compares configuration with how it is used.">
      {(d) => {
        const byModule = new Map<string, ModuleFindings>();
        for (const f of d.findings) {
          const c = byModule.get(f.module) ?? { module: f.module, total: 0, worst: "low" };
          c.total += 1;
          if (SEVERITY_ORDER.indexOf(f.severity) < SEVERITY_ORDER.indexOf(c.worst)) c.worst = f.severity;
          byModule.set(f.module, c);
        }
        return (
          <div className="flex flex-col gap-4">
            {byModule.size > 0 ? (
              <Card title="By module" meta="All systems; select a module for its findings">
                <DataTable columns={moduleCols} data={[...byModule.values()].sort((a, b) => SEVERITY_ORDER.indexOf(a.worst) - SEVERITY_ORDER.indexOf(b.worst) || b.total - a.total)} getRowId={(m) => m.module} onRowClick={(m) => setModuleOpen(m.module)} hideToolbar dense height="auto" tableId="config-alignment-modules" />
              </Card>
            ) : null}
            <FindingsTable rows={d.findings} name="config-alignment" />
            <AlignmentModuleDrawer module={moduleOpen} onClose={() => setModuleOpen(null)} />
          </div>
        );
      }}
    </Feed>
  );
}

function GhostShadowSection() {
  const ghost = useCfg("ghost", getConfigGhost);
  const shadow = useCfg("shadow", getConfigShadow);
  return (
    <div className="flex flex-col gap-4">
      <Card title="Ghost configuration" meta="All systems; configured in SAP but never used in a transaction">
        <Feed q={ghost} empty="Ghost configuration is configured but unused.">{(d) => <FindingsTable rows={d.findings} name="config-ghost" />}</Feed>
      </Card>
      <Card title="Shadow configuration" meta="All systems; used in transactions but missing from the configuration">
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
  const runs = useRef<{ previous: string; current: string }>({ previous: "", current: "" });
  const { open, drawer, column } = useRowDrawer<ConfigDriftEntry>("Change", (e) => (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 m-text-body">
      <dt className="m-ink-2">Previous run</dt><dd><Mono>{runs.current.previous}</Mono></dd>
      <dt className="m-ink-2">Current run</dt><dd><Mono>{runs.current.current}</Mono></dd>
      <dt className="m-ink-2">Previous value</dt><dd><Mono>{dash(e.previous_value)}</Mono></dd>
      <dt className="m-ink-2">Current value</dt><dd><Mono>{dash(e.current_value)}</Mono></dd>
    </dl>
  ));
  const withOpen = useMemo(() => [...cols, column], [cols, column]);
  return (
    <Feed q={q} empty="Drift needs two runs to compare.">
      {(d) => {
        runs.current = { previous: d.previous_run_id, current: d.current_run_id };
        return d.drift_entries.length === 0 ? <EmptyState title="No drift between the last two runs" detail="Configuration is unchanged since the previous run." action={analyseAction} /> : (
          <>
            <DataTable columns={withOpen} data={d.drift_entries} getRowId={(e) => `${e.module}/${e.element_type}/${e.element_value}`} height={380} exportName="config-drift" onRowClick={open} />
            {drawer}
          </>
        );
      }}
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
      {(d) => d.modules.length === 0 ? <EmptyState title="No module utilisation yet" detail="Utilisation is measured from analysed transactions." action={analyseAction} /> : (
        <div className="flex flex-col gap-3">
          <p className="m-text-body m-ink-2">{d.modules.filter((m) => m.utilisation_pct < 25).length.toLocaleString()} of {d.modules.length.toLocaleString()} modules use under a quarter of what is configured</p>
          <DataTable columns={cols} data={[...d.modules].sort((a, b) => a.utilisation_pct - b.utilisation_pct)} getRowId={(m) => m.module} height={320} exportName="licence-utilisation" />
        </div>
      )}
    </Feed>
  );
}

/** Systems/[id] › Configuration. The analysis behind it is tenant-wide, so the header says so. */
export function ConfigurationTab({ systemId, canPropose }: { systemId: string; canPropose: boolean }) {
  const { can } = useRole();
  const discover = useRerun({
    run: () => discoverConfigNow(systemId),
    queryKey: ["config-intelligence"],
    queued: "Discovery started",
  });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="m-text-body m-ink-2">Configuration analysis covers every connected system in this workspace, from the latest run.</p>
        {can("analyse") ? <Button variant="secondary" onClick={() => discover.mutate()} pending={discover.isPending}>Discover now</Button> : null}
      </div>
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

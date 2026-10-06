"use client";

/**
 * Connect and load > one system. Five tabs in the URL (?tab=): Overview, Objects,
 * Runs, Health, Pilot. Actions: Extract, Analyse, Edit (?drawer=edit).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, BarChart, Button, ConnectionTestButton, DataTable, Drawer, Field, Input, LineChart, Select, Stack, Tabs, Text,
  useDrawerParam, type AuroraColumnMeta, type ConnectionTestState,
} from "@/components/aurora";
import { EmptyState, KeyValue, Mono, PageHeader, SectionCard, StatusBadge, TableSkeleton, Tally, type Status } from "@/components/ui-core";
import { PageCrumb } from "@/components/shell/page-crumb";
import { HEALTH_LABEL, latestDqs } from "@/components/data/systems";
import { ConfigLoadButton, ConfigLoadCard, configStatus, hasNoConfig, useConfigLoad } from "@/components/data/config-load";
import { getSystemModules, getSystems, testConnection } from "@/lib/api/connectivity";
import { getFindingsAggregate } from "@/lib/api/findings";
import { discoverSystem, getDesign } from "@/lib/api/source-design";
import { analyseVersion, getSystemVersions, startDownload, type SystemVersion } from "@/lib/api/system-objects";
import { deleteSystem, updateSystem } from "@/lib/api/systems";
import { formatModuleName, relativeTime, formatDate } from "@/lib/format";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import type { SystemModule } from "@/types/api";
import { ConfigTab, CoverageTab, SnapshotsTab, TablesTab } from "./design-panels";
import { PilotTab } from "./pilot-tab";
import { ScopePicker } from "./scope-picker";
import { ReferencePanel } from "./reference-panel";
import { SchedulesPanel } from "./schedules-panel";

type Tab = "overview" | "objects" | "runs" | "health" | "pilot";
const TABS: readonly Tab[] = ["overview", "objects", "runs", "health", "pilot"];
const isTab = (v: string): v is Tab => (TABS as readonly string[]).includes(v);
type Part = "tables" | "config" | "coverage" | "snapshots";
const PARTS: readonly Part[] = ["tables", "config", "coverage", "snapshots"];
const isPart = (v: string): v is Part => (PARTS as readonly string[]).includes(v);

const meta = (m: AuroraColumnMeta) => m;
const when = (iso: string | null | undefined, never = "Never") => (iso ? relativeTime(iso) : never);
const RUN_STATUS: Record<string, Status> = { complete: "ok", failed: "failed", running: "running", pending: "running", extracted: "idle" };
const meanDqs = (v: SystemVersion) => {
  const x = Object.values(v.dqs ?? {}).filter((d): d is number => typeof d === "number");
  return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null;
};
const sumRecords = (v: SystemVersion) => Object.values(v.records ?? {}).reduce((a, b) => a + b, 0);
const findingsHref = (versionId: string, module?: string) =>
  `/analyse?${new URLSearchParams({ tab: "findings", version_id: versionId, ...(module ? { module } : {}) })}`;

export default function SystemPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useRole();
  const [tabParam, setTab] = useUrlState("tab", "overview");
  const tab: Tab = isTab(tabParam) ? tabParam : "overview";
  const drawer = useDrawerParam("drawer");

  const systemsQ = useQuery({ queryKey: ["systems"], queryFn: getSystems });
  const system = systemsQ.data?.find((s) => s.id === id);
  const modulesQ = useQuery({ queryKey: ["system-modules", id], queryFn: () => getSystemModules(id) });
  const versionsQ = useQuery({
    queryKey: ["system-versions", id], queryFn: () => getSystemVersions(id),
    refetchInterval: (q) => (["queued", "running"].includes(q.state.data?.download?.status ?? "") ? 4000 : false),
  });
  const modules = useMemo(() => modulesQ.data ?? [], [modulesQ.data]);
  const versions = useMemo(() => [...(versionsQ.data?.versions ?? [])].sort((a, b) => b.run_at.localeCompare(a.run_at)), [versionsQ.data]);
  const { dqs, version: latest } = latestDqs(versions);
  const aggQ = useQuery({ queryKey: ["system-agg", id, latest?.id], queryFn: () => getFindingsAggregate(latest?.id), enabled: !!latest });

  const alias = system?.name ?? "System";
  const loaded = modules.filter((m) => m.enabled && m.row_count > 0).length;
  const refresh = () => {
    for (const k of ["systems", "system-modules", "system-versions", "design"]) qc.invalidateQueries({ queryKey: [k] });
  };
  const err = (m: string) => (e: unknown) => toast.error((e as Error).message || m);

  const analyse = useMutation({
    mutationFn: () => analyseVersion((latest ?? versions[0]).id),
    onSuccess: () => { toast.success("Analysis started"); refresh(); },
    onError: err("Analysis refused"),
  });

  const crumb = (
    <PageCrumb segments={[
      { level: "portfolio", label: "Portfolio", href: "/" },
      { level: "hub", label: "Connect & load", href: "/data" },
      { level: "page", label: alias },
    ]} />
  );

  if (systemsQ.isLoading) return <div className="ui-page">{crumb}<TableSkeleton rows={6} label="Loading the system" /></div>;
  if (systemsQ.error || !system) {
    return (
      <div className="ui-page">{crumb}
        <Banner tone="danger" title={systemsQ.error ? "The system could not be read" : "No such system"}
          action={<Button size="sm" variant="secondary" onClick={() => systemsQ.refetch()}>Retry</Button>}>
          {systemsQ.error ? (systemsQ.error as Error).message : <>It may have been removed. <Link href="/systems" className="ui-link">Open Systems</Link></>}
        </Banner>
      </div>
    );
  }

  const here = `/systems/${id}`;
  return (
    <div className="ui-page">
      {crumb}
      <PageHeader title={alias}
        summary={`${system.system_type}, ${system.environment}. ${system.last_sync_at ? `Last extraction ${relativeTime(system.last_sync_at)}.` : "Nothing extracted yet."}`}
        actions={<>
          {can("trigger_sync") ? <Button variant="secondary" onClick={() => setTab("objects")}>Extract</Button> : null}
          {can("analyse") ? <Button variant="secondary" onClick={() => analyse.mutate()} disabled={analyse.isPending || !(latest ?? versions[0])}>Analyse</Button> : null}
          {can("manage_systems") ? <Button onClick={() => drawer.open("edit")}>Edit</Button> : null}
        </>} />

      {versionsQ.data?.download?.status === "running" || versionsQ.data?.download?.status === "queued" ? (
        <Banner tone="info" title="Extraction in progress">
          {versionsQ.data.download.table ? <>Reading <Mono>{versionsQ.data.download.table}</Mono>. </> : null}
          {versionsQ.data.download.percent != null ? `${versionsQ.data.download.percent} of 100 percent done.` : null}
        </Banner>
      ) : null}

      <Tally level={2} label={`${alias} at a glance`} figures={[
        { label: "Health", value: null, text: HEALTH_LABEL[system.health_status], href: `${here}?tab=health`,
          tone: system.health_status === "healthy" ? "success" : system.health_status === "unknown" ? undefined : "danger",
          verdict: system.last_health_check ? `Last checked ${relativeTime(system.last_health_check)}.` : "The connection has not been tested." },
        modules.length && loaded
          ? { label: "Objects", value: loaded, unit: `of ${modules.length}`, href: `${here}?tab=objects`, loading: modulesQ.isLoading, verdict: `${loaded} of ${modules.length} objects have rows.` }
          : { label: "Objects", value: null, href: `${here}?tab=objects`, loading: modulesQ.isLoading, verdict: "Never extracted. Download from the source." },
        { label: "Latest DQS", value: dqs === null ? null : Number(dqs.toFixed(1)), href: latest ? findingsHref(latest.id) : `${here}?tab=runs`,
          loading: versionsQ.isLoading, verdict: latest ? `Mean over ${Object.values(latest.dqs).filter((d) => d !== null).length} objects, ${relativeTime(latest.analysed_at ?? latest.run_at)}.` : "Not analysed yet." },
        { label: "Open findings", value: latest ? aggQ.data?.total ?? null : null, href: latest ? findingsHref(latest.id) : `${here}?tab=runs`,
          loading: !!latest && aggQ.isLoading, tone: aggQ.data?.severity.critical ? "danger" : undefined,
          verdict: aggQ.data ? `${aggQ.data.severity.critical} critical and ${aggQ.data.severity.high} high.` : "Findings appear after an analysis." },
      ]} />

      <Tabs<Tab> ariaLabel="System" value={tab} onValueChange={setTab}
        items={[{ id: "overview", label: "Overview" }, { id: "objects", label: "Objects", count: modules.length || undefined },
          { id: "runs", label: "Runs", count: versions.length || undefined }, { id: "health", label: "Health" }, { id: "pilot", label: "Pilot" }]} />

      {tab === "overview" ? <Overview id={id} modules={modules} versions={versions} onRun={(v) => router.push(`/data/runs/${v}`)} /> : null}
      {tab === "objects" ? <Objects id={id} modules={modules} versions={versions} canSync={can("trigger_sync")} canAnalyse={can("analyse")} onChanged={refresh} /> : null}
      {tab === "runs" ? <Runs versions={versions} loading={versionsQ.isLoading} /> : null}
      {tab === "health" ? <Health id={id} canSync={can("trigger_sync")} canManage={can("manage_systems")} onChanged={refresh} /> : null}
      {tab === "pilot" ? <PilotTab id={id} /> : null}

      <Drawer open={drawer.value === "edit"} onClose={drawer.close} ariaLabel="Edit system" header={<Text variant="text-lead">Edit {alias}</Text>}>
        {drawer.value === "edit" ? <EditForm key={system.id} system={system} onDone={() => { drawer.close(); refresh(); }} onDeleted={() => { drawer.close(); refresh(); router.push("/systems"); }} /> : null}
      </Drawer>
    </div>
  );
}

/* ── Overview ──────────────────────────────────────────────────────────── */

function Overview({ id, modules, versions, onRun }: { id: string; modules: SystemModule[]; versions: SystemVersion[]; onRun: (versionId: string) => void }) {
  const router = useRouter();
  const scored = versions.filter((v) => meanDqs(v) !== null).slice(0, 12).reverse();
  const byRows = [...modules].filter((m) => m.row_count > 0).sort((a, b) => b.row_count - a.row_count).slice(0, 12);
  const runCols = useMemo(() => runColumns(), []);
  return (
    <div className="ui-stack">
      <div className="mn-charts">
        <SectionCard title="Score per run" meta={scored.length ? `${scored.length} runs` : undefined}>
          {scored.length < 2 ? <EmptyState>Two analysed runs are needed to draw a trend.</EmptyState> : (
            <LineChart data={scored.map((v) => ({ run: formatDate(v.run_at), dqs: Number((meanDqs(v) ?? 0).toFixed(1)) }))}
              xKey="run" series={[{ key: "dqs", label: "DQS" }]} height={240} ariaLabel="Score per run"
              onPointClick={(i) => router.push(findingsHref(scored[i].id))} />
          )}
        </SectionCard>
        <SectionCard title="Objects by rows" meta={byRows.length ? `${byRows.length} objects` : undefined}>
          {!byRows.length ? <EmptyState>No object has rows yet.</EmptyState> : (
            <BarChart data={byRows.map((m) => ({ object: formatModuleName(m.module), rows: m.row_count }))}
              xKey="object" series={[{ key: "rows", label: "Rows" }]} height={240} ariaLabel="Objects by rows"
              onBarClick={(i) => router.push(`/analyse/object/${byRows[i].module}`)} />
          )}
        </SectionCard>
      </div>
      <SectionCard title="Last 5 runs" action={<Link href={`/systems/${id}?tab=runs`} className="ui-link">All runs</Link>} flush>
        {versions.length ? <DataTable columns={runCols} data={versions.slice(0, 5)} getRowId={(v) => v.id} onRowActivate={(v) => onRun(v.id)} ariaLabel="Last five runs" />
          : <EmptyState>Nothing has been extracted from this system yet.</EmptyState>}
      </SectionCard>
    </div>
  );
}

function runColumns(): ColumnDef<SystemVersion, unknown>[] {
  return [
    { id: "run", header: "Run", meta: meta({ sticky: "start", width: 220 }), cell: ({ row }) => (
      <Link href={`/data/runs/${row.original.id}`} className="ui-link">
        {row.original.label ?? formatDate(row.original.run_at, "datetime")}
      </Link>) },
    { id: "status", header: "Status", meta: meta({ width: 120 }),
      cell: ({ row }) => <StatusBadge status={RUN_STATUS[row.original.status] ?? "idle"}>{row.original.status}</StatusBadge> },
    { id: "objects", header: "Objects", meta: meta({ numeric: true, width: 90 }), cell: ({ row }) => row.original.objects.length },
    { id: "rows", header: "Rows", meta: meta({ numeric: true, width: 110 }), cell: ({ row }) => sumRecords(row.original).toLocaleString() },
    { id: "analysed", header: "Analysed", meta: meta({ width: 130 }), cell: ({ row }) => when(row.original.analysed_at) },
    { id: "dqs", header: "DQS", meta: meta({ numeric: true, width: 80 }), cell: ({ row }) => {
      const d = meanDqs(row.original);
      return d === null ? "—" : <Link href={findingsHref(row.original.id)} className="ui-link">{d.toFixed(1)}</Link>;
    } },
  ];
}

/* ── Objects ───────────────────────────────────────────────────────────── */

function Objects({ id, modules, versions, canSync, canAnalyse, onChanged }: {
  id: string; modules: SystemModule[]; versions: SystemVersion[]; canSync: boolean; canAnalyse: boolean; onChanged: () => void;
}) {
  const router = useRouter();
  const latest = latestDqs(versions).version;
  const sysType = useQuery({ queryKey: ["systems"], queryFn: getSystems }).data?.find((s) => s.id === id)?.system_type;
  const cfg = useConfigLoad(id);
  const cfgStatus = sysType ? configStatus(cfg.load, cfg.running, sysType) : "not_loaded";
  const cfgLabel = cfgStatus === "not_available" ? "Not available" : cfgStatus === "loaded" || cfgStatus === "gaps" ? "Loaded" : cfgStatus === "loading" ? "Loading" : "Not loaded";
  const again = useMutation({
    mutationFn: (module: string) => startDownload(id, { objects: [module], scope: {}, analyse: false }),
    onSuccess: () => { toast.success("Extraction started"); onChanged(); },
    onError: (e) => toast.error((e as Error).message || "Extraction refused"),
  });
  const run = useMutation({
    mutationFn: (versionId: string) => analyseVersion(versionId),
    onSuccess: () => { toast.success("Analysis started"); onChanged(); },
    onError: (e) => toast.error((e as Error).message || "Analysis refused"),
  });
  const columns = useMemo<ColumnDef<SystemModule, unknown>[]>(() => [
    { id: "module", header: "Object", meta: meta({ sticky: "start", width: 220 }),
      cell: ({ row }) => <Link href={`/analyse/object/${row.original.module}`} className="ui-link">{formatModuleName(row.original.module)}</Link> },
    { id: "enabled", header: "Enabled", meta: meta({ width: 90 }), cell: ({ row }) => (row.original.enabled ? "Yes" : "No") },
    { id: "rows", header: "Rows", meta: meta({ numeric: true, width: 110 }), cell: ({ row }) => row.original.row_count.toLocaleString() },
    { id: "synced", header: "Last synced", meta: meta({ width: 130 }), cell: ({ row }) => when(row.original.last_synced_at) },
    { id: "config", header: "Configuration", meta: meta({ width: 120 }), cell: () => cfgLabel },
    { id: "dqs", header: "DQS", meta: meta({ numeric: true, width: 80 }), cell: ({ row }) => {
      const d = latest?.dqs?.[row.original.module];
      return typeof d === "number" ? d.toFixed(1) : "—";
    } },
    { id: "actions", header: "", meta: meta({ width: 230, align: "end" }), cell: ({ row }) => {
      const m = row.original.module;
      const version = versions.find((v) => v.analysable && v.objects.includes(m));
      return (
        <Stack direction="row" gap={2}>
          {canSync ? <Button size="sm" variant="secondary" disabled={again.isPending || !row.original.enabled}
            onClick={(e) => { e.stopPropagation(); again.mutate(m); }}>Extract again</Button> : null}
          {canAnalyse ? <Button size="sm" variant="ghost" disabled={run.isPending || !version}
            onClick={(e) => { e.stopPropagation(); if (version) run.mutate(version.id); }}>Analyse</Button> : null}
        </Stack>
      );
    } },
  ], [again, run, canSync, canAnalyse, latest, versions, cfgLabel]);
  return (
    <div className="ui-stack">
      {canSync ? <ScopePicker id={id} onDownloaded={onChanged} /> : null}
      {modules.length ? (
        <DataTable columns={columns} data={modules} getRowId={(m) => m.module} onRowActivate={(m) => router.push(`/analyse/object/${m.module}`)} ariaLabel="Objects of this system" maxHeight="65vh" />
      ) : <EmptyState>This system offers no objects yet.</EmptyState>}
    </div>
  );
}

/* ── Runs ──────────────────────────────────────────────────────────────── */

function Runs({ versions, loading }: { versions: SystemVersion[]; loading: boolean }) {
  const router = useRouter();
  const columns = useMemo(() => runColumns(), []);
  if (loading) return <TableSkeleton rows={6} label="Loading runs" />;
  if (!versions.length) return <EmptyState>Nothing has been extracted from this system yet.</EmptyState>;
  return <DataTable columns={columns} data={versions} getRowId={(v) => v.id}
    onRowActivate={(v) => router.push(`/data/runs/${v.id}`)} ariaLabel="Runs of this system" maxHeight="65vh" />;
}

/* ── Health ────────────────────────────────────────────────────────────── */

function Health({ id, canSync, canManage, onChanged }: {
  id: string; canSync: boolean; canManage: boolean; onChanged: () => void;
}) {
  const systemsQ = useQuery({ queryKey: ["systems"], queryFn: getSystems });
  const system = systemsQ.data?.find((s) => s.id === id);
  const designQ = useQuery({
    queryKey: ["design", id], queryFn: () => getDesign(id),
    refetchInterval: (q) => (["queued", "running"].includes(q.state.data?.discovery_status ?? "") ? 3000 : false),
  });
  const design = designQ.data;
  const [partParam, setPart] = useUrlState("part", "tables");
  const part: Part = isPart(partParam) ? partParam : "tables";
  const snap = design?.snapshot;
  const running = ["queued", "running"].includes(design?.discovery_status ?? "");

  const test = useMutation({
    mutationFn: () => testConnection(id),
    onSuccess: (r) => { toast.success(`Connection ${r.status}, ${r.latency_ms} ms`); onChanged(); },
    onError: (e) => toast.error((e as Error).message || "Connection test failed"),
  });
  const testState: ConnectionTestState = test.isPending ? "testing" : test.isError ? "error" : test.data ? (test.data.status === "healthy" ? "success" : "error") : "idle";
  const cfg = useConfigLoad(id);
  const discover = useMutation({
    mutationFn: () => discoverSystem(id),
    onSuccess: () => { toast.success("Discovery started"); onChanged(); },
    onError: (e) => toast.error((e as Error).message || "Could not start discovery"),
  });

  if (!system) return null;
  const verdict = system.health_status === "healthy"
    ? `The connection is healthy${system.last_health_check ? `, checked ${relativeTime(system.last_health_check)}` : ""}.`
    : `The connection is ${HEALTH_LABEL[system.health_status].toLowerCase()}${system.health_message ? `: ${system.health_message}` : ""}.`;

  return (
    <div className="ui-stack">
      <SectionCard title="Connection" action={<Stack direction="row" gap={2}>
        {canSync ? <ConnectionTestButton state={testState} onTest={() => test.mutate()} /> : null}
        {canSync && !hasNoConfig(system.system_type) ? <ConfigLoadButton running={cfg.running} loaded={!!cfg.load} onClick={() => cfg.start.mutate()} /> : null}
        {canSync ? <Button size="sm" variant="secondary" disabled={discover.isPending || running} onClick={() => discover.mutate()}>
          {running ? "Discovering" : snap ? "Discover again" : "Discover design"}</Button> : null}
      </Stack>}>
        <p className="ui-note">{verdict}</p>
        <KeyValue rows={[
          { k: "Health", v: <StatusBadge status={system.health_status === "healthy" ? "ok" : system.health_status === "unknown" ? "idle" : "failed"}>{HEALTH_LABEL[system.health_status]}</StatusBadge> },
          { k: "Last health check", v: when(system.last_health_check, "Never") },
          { k: "Discovery status", v: design?.discovery_status ?? system.discovery_status ?? "Never run" },
          { k: "SAP release", v: design?.sap_release ?? "Unknown", mono: true },
        ]} />
        {snap?.error ? <Banner tone="warning" title={`Discovery ${snap.status}`}>{snap.error}</Banner> : null}
      </SectionCard>

      <ConfigLoadCard systemId={id} systemType={system.system_type} canLoad={canSync} />

      <SchedulesPanel id={id} canManage={canManage} />
      {canManage ? <ReferencePanel id={id} /> : null}

      <SectionCard title="Design discovery" meta={snap ? `${snap.tables.toLocaleString()} tables read` : undefined}>
        {!snap ? <EmptyState>Not discovered yet. Discover design reads this system&apos;s data dictionary and configuration.</EmptyState> : (
          <Stack gap={3}>
            <Tabs<Part> ariaLabel="Design discovery" value={part} onValueChange={setPart}
              items={[{ id: "tables", label: "Data dictionary", count: snap.tables }, { id: "config", label: "Configuration", count: design?.configuration.length },
                { id: "coverage", label: "Coverage" }, { id: "snapshots", label: "History" }]} />
            {part === "tables" ? <TablesTab id={id} /> : null}
            {part === "config" && design ? <ConfigTab id={id} tables={design.configuration} /> : null}
            {part === "coverage" ? <CoverageTab id={id} /> : null}
            {part === "snapshots" ? <SnapshotsTab id={id} /> : null}
          </Stack>
        )}
      </SectionCard>
    </div>
  );
}

/* ── Edit ──────────────────────────────────────────────────────────────── */

function EditForm({ system, onDone, onDeleted }: {
  system: { id: string; name: string; environment: "PRD" | "QAS" | "DEV"; description: string | null; is_active: boolean };
  onDone: () => void; onDeleted: () => void;
}) {
  const [name, setName] = useState(system.name);
  const [environment, setEnvironment] = useState<string>(system.environment);
  const [description, setDescription] = useState(system.description ?? "");
  const [active, setActive] = useState(system.is_active);
  const [confirming, setConfirming] = useState(false);
  const save = useMutation({
    mutationFn: () => updateSystem(system.id, { name: name.trim(), environment, description, is_active: active }),
    onSuccess: () => { toast.success("System saved"); onDone(); },
    onError: (e) => toast.error((e as Error).message || "Not saved"),
  });
  const del = useMutation({
    mutationFn: () => deleteSystem(system.id),
    onSuccess: () => { toast.success(`${system.name} removed`); onDeleted(); },
    onError: (e) => toast.error((e as Error).message || "Not removed"),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(); }}>
      <Stack gap={4}>
        <Field label="Alias" required>{({ controlId }) => <Input id={controlId} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Environment">{({ controlId }) => <Select id={controlId} options={["DEV", "QAS", "PRD"].map((v) => ({ value: v, label: v }))}
          value={environment} onValueChange={setEnvironment} />}</Field>
        <Field label="Description" helper="Optional">{({ controlId }) => <Input id={controlId} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <label className="ui-micro"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active</label>
        <Stack direction="row" gap={2}>
          <Button type="submit" disabled={!name.trim() || save.isPending}>Save</Button>
          {!confirming ? <Button type="button" variant="danger" onClick={() => setConfirming(true)}>Delete</Button> : null}
        </Stack>
        {confirming ? (
          <Banner tone="danger" title={`Remove ${system.name}?`} action={
            <Stack direction="row" gap={2}>
              <Button type="button" variant="danger" size="sm" onClick={() => del.mutate()} disabled={del.isPending}>Remove</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>Keep</Button>
            </Stack>}>
            Its credentials and sync profiles go with it. Downloaded runs and findings stay.
          </Banner>
        ) : null}
      </Stack>
    </form>
  );
}

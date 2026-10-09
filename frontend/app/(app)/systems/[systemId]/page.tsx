"use client";

/**
 * One system: Overview, Objects, Runs, Health, Pilot tabs. @/design's Tabs
 * is uncontrolled, so the ?tab= deep link is read once (useSearchParams)
 * and passed as defaultValue — enough to land `/systems/:id/pilot`'s
 * redirect to `?tab=pilot` on the right tab; no live two-way sync.
 * Edit via a Drawer.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Bar, Button, DataTable, Drawer, EmptyState, ErrorState, Field, Line, Mono, Pill, Select, Skeleton, Stat, Tabs,
  type PillTone,
} from "@/design";
import { HEALTH_LABEL, latestDqs } from "../_health";
import { ConfigLoadButton, ConfigLoadPanel, configStatus, hasNoConfig, useConfigLoad } from "./config-load-panel";
import { getSystemModules, getSystems, testConnection } from "@/lib/api/connectivity";
import { getFindingsAggregate } from "@/lib/api/findings";
import { discoverSystem, getDesign } from "@/lib/api/source-design";
import { analyseVersion, getSystemVersions, startDownload, type SystemVersion } from "@/lib/api/system-objects";
import { deleteSystem, updateSystem } from "@/lib/api/systems";
import { formatModuleName, labelOf, relativeTime, formatDate } from "@/lib/format";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { queryKeys } from "@/lib/query-keys";
import type { SystemModule, SystemType } from "@/types/api";
import { ConfigTab, CoverageTab, SnapshotsTab, TablesTab } from "./design-panels";
import { PilotTab } from "./pilot-tab";
import { ScopePicker } from "./scope-picker";
import { ReferencePanel } from "./reference-panel";
import { SchedulesPanel } from "./schedules-panel";

const when = (iso: string | null | undefined, never = "Never") => (iso ? relativeTime(iso) : never);
const meanDqs = (v: SystemVersion) => {
  const x = Object.values(v.dqs ?? {}).filter((d): d is number => typeof d === "number");
  return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null;
};
const sumRecords = (v: SystemVersion) => Object.values(v.records ?? {}).reduce((a, b) => a + b, 0);
const findingsHref = (versionId: string, module?: string) =>
  `/runs/${versionId}${module ? `?module=${module}` : ""}`;
const HEALTH_TONE: Record<string, PillTone> = { healthy: "go", unknown: "neutral" };

function runColumns(): ColumnDef<SystemVersion>[] {
  return [
    {
      id: "run",
      header: "Run",
      cell: ({ row }) => (
        <Link href={`/runs/${row.original.id}`} className="underline">
          {row.original.label ?? formatDate(row.original.run_at, "datetime")}
        </Link>
      ),
    },
    { id: "status", header: "Status", cell: ({ row }) => <Pill>{labelOf(row.original.status)}</Pill> },
    { id: "objects", header: "Objects", cell: ({ row }) => row.original.objects.length },
    { id: "rows", header: "Rows", cell: ({ row }) => sumRecords(row.original).toLocaleString() },
    { id: "analysed", header: "Analysed", cell: ({ row }) => when(row.original.analysed_at) },
    {
      id: "dqs",
      header: "DQS",
      cell: ({ row }) => {
        const d = meanDqs(row.original);
        return d === null ? "—" : (
          <Link href={findingsHref(row.original.id)} className="underline">
            {d.toFixed(1)}
          </Link>
        );
      },
    },
  ];
}

export default function SystemPage() {
  const { systemId } = useParams<{ systemId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const { can } = useRole();
  const [editOpen, setEditOpen] = useState(false);
  const initialTab = searchParams.get("tab") ?? "overview";

  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const system = systemsQ.data?.find((s) => s.id === systemId);
  const modulesQ = useQuery({ queryKey: queryKeys.systemModules(systemId), queryFn: () => getSystemModules(systemId) });
  const versionsQ = useQuery({
    queryKey: queryKeys.systemVersions(systemId),
    queryFn: () => getSystemVersions(systemId),
    refetchInterval: (q) => (["queued", "running"].includes(q.state.data?.download?.status ?? "") ? 4000 : false),
  });
  const modules = useMemo(() => modulesQ.data ?? [], [modulesQ.data]);
  const versions = useMemo(
    () => [...(versionsQ.data?.versions ?? [])].sort((a, b) => b.run_at.localeCompare(a.run_at)),
    [versionsQ.data],
  );
  const { dqs, version: latest } = latestDqs(versions);
  const aggQ = useQuery({
    queryKey: queryKeys.systemAgg(systemId, latest?.id),
    queryFn: () => getFindingsAggregate(latest!.id),
    enabled: !!latest,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: queryKeys.systems() });
    qc.invalidateQueries({ queryKey: queryKeys.systemModules(systemId) });
    qc.invalidateQueries({ queryKey: queryKeys.systemVersions(systemId) });
    qc.invalidateQueries({ queryKey: queryKeys.design(systemId) });
  };

  const analyse = useMutation({
    mutationFn: () => analyseVersion((latest ?? versions[0])!.id),
    onSuccess: () => { toast.success("Analysis started"); refresh(); },
    onError: (e) => toast.error((e as Error).message || "Analysis refused"),
  });

  if (systemsQ.isLoading) return <Skeleton height={240} />;
  if (systemsQ.isError || !system) {
    return (
      <ErrorState
        message={systemsQ.isError ? `Couldn't load this system. ${systemsQ.error?.message ?? ""}`.trim() : "No such system."}
        onRetry={() => systemsQ.refetch()}
      />
    );
  }

  const loaded = modules.filter((m) => m.enabled && m.row_count > 0).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[20px] font-semibold" style={{ color: "var(--m-ink)" }}>{system.name}</p>
          <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
            {labelOf(system.system_type)}, {system.environment}.{" "}
            {system.last_sync_at ? `Last extraction ${relativeTime(system.last_sync_at)}.` : "Nothing extracted yet."}
          </p>
        </div>
        <div className="flex gap-2">
          {can("analyse") ? (
            <Button variant="secondary" disabled={analyse.isPending || !(latest ?? versions[0])} onClick={() => analyse.mutate()}>
              Analyse
            </Button>
          ) : null}
          {can("manage_systems") ? <Button onClick={() => setEditOpen(true)}>Edit</Button> : null}
        </div>
      </div>

      {versionsQ.data?.download?.status === "running" || versionsQ.data?.download?.status === "queued" ? (
        <div className="rounded border px-3 py-2 text-[13px]" style={{ borderColor: "var(--m-line)", color: "var(--m-ink-2)" }}>
          Extraction in progress.
          {versionsQ.data.download.table ? (
            <>
              {" "}Reading <Mono>{versionsQ.data.download.table}</Mono>.
            </>
          ) : null}
          {versionsQ.data.download.percent != null ? ` ${versionsQ.data.download.percent} of 100 percent done.` : null}
        </div>
      ) : null}

      <div className="grid grid-cols-4 gap-4">
        <Stat label="Health" value={HEALTH_LABEL[system.health_status]} />
        <Stat label="Objects" value={modules.length ? `${loaded} of ${modules.length}` : "—"} />
        <Stat label="Latest DQS" value={dqs === null ? "—" : dqs.toFixed(1)} />
        <Stat label="Open findings" value={latest ? aggQ.data?.total ?? "…" : "—"} />
      </div>

      <Tabs
        defaultValue={initialTab}
        onValueChange={(tab) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set("tab", tab);
          router.replace(`/systems/${systemId}?${params.toString()}`, { scroll: false });
        }}
        items={[
          { value: "overview", label: "Overview", content: <Overview versions={versions} modules={modules} /> },
          {
            value: "objects",
            label: "Objects",
            content: (
              <Objects
                id={systemId}
                system={system}
                modules={modules}
                versions={versions}
                canSync={can("trigger_sync")}
                canAnalyse={can("analyse")}
                onChanged={refresh}
              />
            ),
          },
          { value: "runs", label: "Runs", content: <Runs systemId={systemId} versions={versions} loading={versionsQ.isLoading} /> },
          {
            value: "health",
            label: "Health",
            content: (
              <Health id={systemId} system={system} canSync={can("trigger_sync")} canManage={can("manage_systems")} onChanged={refresh} />
            ),
          },
          { value: "pilot", label: "Pilot", content: <PilotTab id={systemId} /> },
        ]}
      />

      <Drawer open={editOpen} onOpenChange={setEditOpen} title={`Edit ${system.name}`}>
        <EditForm
          system={system}
          onDone={() => { setEditOpen(false); refresh(); }}
          onDeleted={() => { setEditOpen(false); refresh(); router.push("/systems"); }}
        />
      </Drawer>
    </div>
  );
}

/* ── Overview ──────────────────────────────────────────────────────────── */

function Overview({ modules, versions }: { modules: SystemModule[]; versions: SystemVersion[] }) {
  const router = useRouter();
  const scored = versions.filter((v) => meanDqs(v) !== null).slice(0, 12).reverse();
  const byRows = [...modules].filter((m) => m.row_count > 0).sort((a, b) => b.row_count - a.row_count).slice(0, 12);
  const runCols = useMemo(() => runColumns(), []);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[13px] font-medium" style={{ color: "var(--m-ink)" }}>Score per run</p>
          {scored.length < 2 ? (
            <EmptyState title="Two analysed runs are needed to draw a trend." />
          ) : (
            <Line
              data={scored.map((v) => ({ x: formatDate(v.run_at), y: Number((meanDqs(v) ?? 0).toFixed(1)) }))}
              onPointClick={(p) => {
                const v = scored.find((s) => formatDate(s.run_at) === p.x);
                if (v) router.push(findingsHref(v.id));
              }}
            />
          )}
        </div>
        <div>
          <p className="text-[13px] font-medium" style={{ color: "var(--m-ink)" }}>Objects by rows</p>
          {!byRows.length ? (
            <EmptyState title="No object has rows yet." />
          ) : (
            <Bar
              data={byRows.map((m) => ({ x: formatModuleName(m.module), y: m.row_count }))}
              onPointClick={(p) => {
                const m = byRows.find((b) => formatModuleName(b.module) === p.x);
                if (m) router.push(`/objects/${m.module}`);
              }}
            />
          )}
        </div>
      </div>
      <div>
        <p className="text-[13px] font-medium" style={{ color: "var(--m-ink)" }}>Last 5 runs</p>
        {versions.length ? (
          <DataTable columns={runCols} data={versions.slice(0, 5)} getRowId={(v) => v.id} onRowClick={(v) => router.push(`/runs/${v.id}`)} />
        ) : (
          <EmptyState title="Nothing has been extracted from this system yet." />
        )}
      </div>
    </div>
  );
}

/* ── Objects ───────────────────────────────────────────────────────────── */

function Objects({ id, system, modules, versions, canSync, canAnalyse, onChanged }: {
  id: string;
  system: { system_type: SystemType };
  modules: SystemModule[];
  versions: SystemVersion[];
  canSync: boolean;
  canAnalyse: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const latest = latestDqs(versions).version;
  const cfg = useConfigLoad(id);
  const cfgStatus = configStatus(cfg.load, cfg.running, system.system_type);
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
  const columns = useMemo<ColumnDef<SystemModule>[]>(() => [
    {
      id: "module",
      header: "Object",
      cell: ({ row }) => <Link href={`/objects/${row.original.module}`} className="underline">{formatModuleName(row.original.module)}</Link>,
    },
    { id: "enabled", header: "Enabled", cell: ({ row }) => (row.original.enabled ? "Yes" : "No") },
    { id: "rows", header: "Rows", cell: ({ row }) => row.original.row_count.toLocaleString() },
    { id: "synced", header: "Last synced", cell: ({ row }) => when(row.original.last_synced_at) },
    { id: "config", header: "Configuration", cell: () => cfgLabel },
    {
      id: "dqs",
      header: "DQS",
      cell: ({ row }) => {
        const d = latest?.dqs?.[row.original.module];
        return typeof d === "number" ? d.toFixed(1) : "—";
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const m = row.original.module;
        const version = versions.find((v) => v.analysable && v.objects.includes(m));
        return (
          <div className="flex gap-2">
            {canSync ? (
              <Button
                variant="secondary"
                disabled={again.isPending || !row.original.enabled}
                onClick={(e) => { e.stopPropagation(); again.mutate(m); }}
              >
                Extract again
              </Button>
            ) : null}
            {canAnalyse ? (
              <Button
                variant="ghost"
                disabled={run.isPending || !version}
                onClick={(e) => { e.stopPropagation(); if (version) run.mutate(version.id); }}
              >
                Analyse
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ], [again, run, canSync, canAnalyse, latest, versions, cfgLabel]);
  return (
    <div className="flex flex-col gap-4">
      {canSync ? <ScopePicker id={id} onDownloaded={onChanged} /> : null}
      {modules.length ? (
        <DataTable columns={columns} data={modules} getRowId={(m) => m.module} onRowClick={(m) => router.push(`/objects/${m.module}`)} />
      ) : (
        <EmptyState title="This system offers no objects yet." />
      )}
    </div>
  );
}

/* ── Runs ──────────────────────────────────────────────────────────────── */

function Runs({ systemId, versions, loading }: { systemId: string; versions: SystemVersion[]; loading: boolean }) {
  const router = useRouter();
  const columns = useMemo(() => runColumns(), []);
  if (loading) return <Skeleton height={240} />;
  if (!versions.length) return <EmptyState title="Nothing has been extracted from this system yet." />;
  return (
    <DataTable
      columns={columns}
      data={versions}
      getRowId={(v) => v.id}
      onRowClick={(v) => router.push(`/systems/${systemId}/extractions/${v.id}`)}
    />
  );
}

/* ── Health ────────────────────────────────────────────────────────────── */

function Health({ id, system, canSync, canManage, onChanged }: {
  id: string;
  system: { health_status: keyof typeof HEALTH_LABEL; health_message: string | null; last_health_check: string | null; discovery_status?: string | null; system_type: SystemType };
  canSync: boolean;
  canManage: boolean;
  onChanged: () => void;
}) {
  const designQ = useQuery({
    queryKey: queryKeys.design(id),
    queryFn: () => getDesign(id),
    refetchInterval: (q) => (["queued", "running"].includes(q.state.data?.discovery_status ?? "") ? 3000 : false),
  });
  const design = designQ.data;
  const snap = design?.snapshot;
  const running = ["queued", "running"].includes(design?.discovery_status ?? "");
  const [part, setPart] = useUrlState("part", "tables");

  const test = useMutation({
    mutationFn: () => testConnection(id),
    onSuccess: (r) => { toast.success(`Connection ${r.status}, ${r.latency_ms} ms`); onChanged(); },
    onError: (e) => toast.error((e as Error).message || "Connection test failed"),
  });
  const testLabel = test.isPending
    ? "Testing"
    : test.isError || (test.data && test.data.status !== "healthy")
      ? "Test failed, retry"
      : test.data
        ? "Connection tested"
        : "Test connection";
  const cfg = useConfigLoad(id);
  const discover = useMutation({
    mutationFn: () => discoverSystem(id),
    onSuccess: () => { toast.success("Discovery started"); onChanged(); },
    onError: (e) => toast.error((e as Error).message || "Could not start discovery"),
  });

  const verdict = system.health_status === "healthy"
    ? `The connection is healthy${system.last_health_check ? `, checked ${relativeTime(system.last_health_check)}` : ""}.`
    : `The connection is ${HEALTH_LABEL[system.health_status].toLowerCase()}${system.health_message ? `: ${system.health_message}` : ""}.`;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded border p-3" style={{ borderColor: "var(--m-line)" }}>
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium" style={{ color: "var(--m-ink)" }}>Connection</p>
          <div className="flex gap-2">
            {canSync ? <Button variant="secondary" disabled={test.isPending} onClick={() => test.mutate()}>{testLabel}</Button> : null}
            {canSync && !hasNoConfig(system.system_type) ? (
              <ConfigLoadButton running={cfg.running} loaded={!!cfg.load} onClick={() => cfg.start.mutate()} />
            ) : null}
            {canSync ? (
              <Button variant="secondary" disabled={discover.isPending || running} onClick={() => discover.mutate()}>
                {running ? "Discovering" : snap ? "Discover again" : "Discover design"}
              </Button>
            ) : null}
          </div>
        </div>
        <p className="text-[13px] mt-1" style={{ color: "var(--m-ink-2)" }}>{verdict}</p>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-[13px]">
          <Field label="Health"><Pill tone={HEALTH_TONE[system.health_status] ?? "no-go"}>{HEALTH_LABEL[system.health_status]}</Pill></Field>
          <Field label="Last health check"><span>{when(system.last_health_check, "Never")}</span></Field>
          <Field label="Discovery status"><span>{design?.discovery_status ?? system.discovery_status ?? "Never run"}</span></Field>
          <Field label="SAP release"><Mono>{design?.sap_release ?? "Unknown"}</Mono></Field>
        </dl>
        {snap?.error ? (
          <div className="mt-2 rounded border px-3 py-2 text-[13px]" style={{ borderColor: "var(--m-medium)", color: "var(--m-medium)" }}>
            Discovery {labelOf(snap.status)}: {snap.error}
          </div>
        ) : null}
      </div>

      <ConfigLoadPanel systemId={id} systemType={system.system_type} canLoad={canSync} />
      <SchedulesPanel id={id} canManage={canManage} />
      {canManage ? <ReferencePanel id={id} /> : null}

      <div className="rounded border p-3" style={{ borderColor: "var(--m-line)" }}>
        <p className="text-[13px] font-medium" style={{ color: "var(--m-ink)" }}>Design discovery</p>
        {!snap ? (
          <EmptyState title="Not discovered yet. Discover design reads this system's data dictionary and configuration." />
        ) : (
          <Tabs
            value={part}
            onValueChange={setPart}
            items={[
              { value: "tables", label: "Data dictionary", content: <TablesTab id={id} /> },
              { value: "config", label: "Configuration", content: design ? <ConfigTab id={id} tables={design.configuration} /> : null },
              { value: "coverage", label: "Coverage", content: <CoverageTab id={id} /> },
              { value: "snapshots", label: "History", content: <SnapshotsTab id={id} /> },
            ]}
          />
        )}
      </div>
    </div>
  );
}

/* ── Edit ──────────────────────────────────────────────────────────────── */

function EditForm({ system, onDone, onDeleted }: {
  system: { id: string; name: string; environment: "PRD" | "QAS" | "DEV"; description: string | null; is_active: boolean };
  onDone: () => void;
  onDeleted: () => void;
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
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => { e.preventDefault(); if (name.trim()) save.mutate(); }}
    >
      <Field label="Alias">
        <input
          className="w-full rounded border px-3 py-1.5 text-[13px]"
          style={{ borderColor: "var(--m-line)" }}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Environment">
        <Select
          value={environment}
          onValueChange={setEnvironment}
          options={["DEV", "QAS", "PRD"].map((v) => ({ value: v, label: v }))}
        />
      </Field>
      <Field label="Description">
        <input
          className="w-full rounded border px-3 py-1.5 text-[13px]"
          style={{ borderColor: "var(--m-line)" }}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={!name.trim() || save.isPending}>Save</Button>
        {!confirming ? <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>Delete</Button> : null}
      </div>
      {confirming ? (
        <div className="rounded border p-3" style={{ borderColor: "var(--m-critical)" }}>
          <p className="text-[13px]" style={{ color: "var(--m-ink)" }}>
            Remove {system.name}? Its credentials and sync profiles go with it. Downloaded runs and findings stay.
          </p>
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="secondary" disabled={del.isPending} onClick={() => del.mutate()}>Remove</Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>Keep</Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}

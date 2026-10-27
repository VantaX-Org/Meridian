"use client";

/**
 * One system: Overview, Objects, Runs, Health, Pilot tabs. The active tab is
 * controlled from the ?tab= search param, so Stat links and redirects switch it.
 * Edit via a Drawer. `?extract=1` lands with the Extract drawer open, with each `?object=` picked.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { clsx } from "clsx";
import { Bar, Button, Card, Checkbox, ConfirmDialog, DataTable, Delta, Drawer, DrillLink, EmptyState, ErrorState, ExportMenu, Field, Input, Line, Mono, Notice, PageHeader, Pill, Select, Skeleton, Stat, Status, Tabs, Tooltip, emptyExportOptions, type Verdict, entityTabs, toVerdict, toast, useBreadcrumbTitle, Score } from "@/design";
import { HEALTH_LABEL, dqsTrend, latestDqs } from "../_health";
import { DqsScore } from "@/components/insight/dqs-score";
import { ConfigurationTab } from "./config-tab";
import { CustomObjectsTab } from "./custom-objects-tab";
import { PreviewBadge } from "@/components/systems/preview-badge";
import { ConfigLoadPanel } from "./config-load-panel";
import { TrendPanel } from "./trend-panel";
import { getSystemModules, getSystems, testConnection } from "@/lib/api/connectivity";
import { getFindingsAggregate } from "@/lib/api/findings";
import { getObjects, type ObjectSummary } from "@/lib/api/v1/objects";
import { discoverSystem, getDesign } from "@/lib/api/source-design";
import { analyseVersion, downloadPollMs, getSystemVersions, objectsLoaded, startDownload, type SystemVersion } from "@/lib/api/system-objects";
import { deleteSystem, getSyncProfiles, testEditedConnection, updateSystem } from "@/lib/api/systems";
import { exportRuns } from "@/lib/api/versions";
import { formatDate, formatModuleName, labelOf, relativeTime, systemTypeLabel } from "@/lib/format";
import { runAxisTicks } from "@/lib/run-axis";
import { GatedPrimary, primaryRole } from "@/components/gated-primary";
import { ConnectionFields, ENVIRONMENTS, RFC_TYPES, TestOutcome, authFor, connectionKey, connectionOf, environmentLabel, schemaFor, testBlockedHint, type ConnectionValues, type TestOutcomeValue } from "@/components/systems/connect-system-dialog";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { queryKeys } from "@/lib/query-keys";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { useFormErrors } from "@/lib/forms";
import { runPageHref } from "@/lib/runs";
import { runName } from "@/lib/run-scope";
import type { SAPSystemExtended, SystemModule, SystemType, TestConnectionResponse } from "@/types/api";
import { ConfigTab, CoverageTab, SnapshotsTab, TablesTab } from "./design-panels";
import { PilotTab } from "./pilot-tab";
import { ScopePicker } from "./scope-picker";
import { ReferencePanel } from "./reference-panel";
import { SchedulesPanel } from "./schedules-panel";

/** Longest to wait for a just-started download to report progress. */
const AWAIT_DOWNLOAD_MS = 120_000;
/** The sentence every live-system confirmation carries. */
const READ_ONLY = "Read-only: Meridian never writes to SAP.";
const when = (iso: string | null | undefined, never = "Never") => (iso ? relativeTime(iso) : never);
const meanDqs = (v: SystemVersion) => {
  const x = Object.values(v.dqs ?? {}).filter((d): d is number => typeof d === "number");
  return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null;
};
const sumRecords = (v: SystemVersion) => Object.values(v.records ?? {}).reduce((a, b) => a + b, 0);
/** The run's Findings tab, filtered to one object when given. */
const findingsHref = (versionId: string, module?: string) =>
  `/runs/${versionId}?tab=findings${module ? `&module=${encodeURIComponent(module)}` : ""}`;
/** "ECC Prod (Production)": the system and environment every confirmation names. */
/**
 * The Health stat's hint. An unhealthy connection says why and when it was last checked ("Connection refused,
 * checked 5m ago"); a healthy or untested one says when data last came in.
 */
function healthHint(s: SAPSystemExtended, hasRuns: boolean): string {
  const failing = s.health_status !== "healthy" && s.health_status !== "unknown";
  if (failing) {
    const reason = s.health_message?.trim() || "No reason recorded";
    return `${reason}, ${s.last_health_check ? `checked ${relativeTime(s.last_health_check)}` : "never checked"}`;
  }
  return s.last_sync_at ? `Last extracted ${relativeTime(s.last_sync_at)}` : hasRuns ? "Runs read, nothing extracted through the connection yet" : "Nothing extracted yet";
}

const systemScope = (s: { name: string; environment: string }) => `${s.name} (${environmentLabel(s.environment)})`;

/** With `systemId`, each row also links to its extraction log (the Runs tab); without, the overview's short list. */
function runColumns(systemId?: string): ColumnDef<SystemVersion>[] {
  return [
    {
      id: "run",
      header: "Run",
      cell: ({ row }) => (
        <Link href={`/runs/${row.original.id}`} className="underline">
          {runName(row.original)}
        </Link>
      ),
    },
    { id: "status", header: "Status", cell: ({ row }) => <Status kind="lifecycle" value={row.original.status} /> },
    { id: "objects", header: "Objects", cell: ({ row }) => <DrillLink href={`/runs/${row.original.id}?tab=objects`}>{row.original.objects.length}</DrillLink> },
    { id: "rows", header: "Records", cell: ({ row }) => <DrillLink href={`/runs/${row.original.id}`}>{sumRecords(row.original).toLocaleString()}</DrillLink> },
    { id: "analysed", header: "Analysed", cell: ({ row }) => when(row.original.analysed_at) },
    {
      id: "dqs",
      header: "Score",
      cell: ({ row }) => {
        const d = meanDqs(row.original);
        return d === null ? "—" : (
          // The run summary carries the score explainer.
          <Score size="sm" value={d}><DrillLink href={`/runs/${row.original.id}`}>{d.toFixed(1)}</DrillLink></Score>
        );
      },
    },
    ...(systemId ? [{
      id: "log",
      header: "Extraction",
      cell: ({ row }) => (
        <Link href={`/systems/${systemId}/extractions/${row.original.id}`} className="underline">
          {row.original.status === "failed" ? "Why it failed" : "Extraction log"}
        </Link>
      ),
    } satisfies ColumnDef<SystemVersion>] : []),
  ];
}

export default function SystemPage() {
  const { systemId } = useParams<{ systemId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const { can, loading: permsLoading } = useRole();
  const [editOpen, setEditOpen] = useState(false);
  // `?extract=1` asks for the Extract drawer; it only renders for trigger_sync, else the page says why below.
  const extractAsked = searchParams.get("extract") === "1";
  const [extractOpen, setExtractOpen] = useState(extractAsked);
  const [confirmAnalyse, setConfirmAnalyse] = useState(false);
  const [awaitedJobId, setAwaitedJobId] = useState<string | null>(null); // job id of the download just started, while its progress is awaited
  const initialTab = searchParams.get("tab") ?? "overview";

  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const system = systemsQ.data?.find((s) => s.id === systemId);
  const modulesQ = useQuery({ queryKey: queryKeys.systemModules(systemId), queryFn: () => getSystemModules(systemId) });
  const versionsQ = useQuery({
    queryKey: queryKeys.systemVersions(systemId),
    queryFn: () => getSystemVersions(systemId),
    refetchInterval: (q) => downloadPollMs(q.state.data?.download, awaitedJobId),
  });
  const download = versionsQ.data?.download;
  useEffect(() => {
    if (awaitedJobId === null) return;
    const t = setTimeout(() => setAwaitedJobId(null), AWAIT_DOWNLOAD_MS); // one deadline per start: never poll forever for a job that does not report
    return () => clearTimeout(t);
  }, [awaitedJobId]);
  if (awaitedJobId !== null && download?.job_id === awaitedJobId && download.status !== "queued" && download.status !== "running") {
    setAwaitedJobId(null); // the awaited download finished: stop waiting (state adjusted during render)
  }
  const modules = useMemo(() => modulesQ.data ?? [], [modulesQ.data]);
  const versions = useMemo(
    () => [...(versionsQ.data?.versions ?? [])].sort((a, b) => b.run_at.localeCompare(a.run_at)),
    [versionsQ.data],
  );
  const { dqs, version: latest } = latestDqs(versions);
  // The page's h1 is the system's name, with Systems as the crumb before it.
  useBreadcrumbTitle(system ? { label: system.name, parent: { label: "Systems", href: "/systems" } } : null);
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

  const test = useMutation({
    mutationFn: () => testConnection(systemId),
    onSuccess: (r) => {
      if (r.status === "healthy") {
        toast.success(`Connection healthy, ${r.latency_ms} ms`);
      } else {
        // The cause is the message; the fix is usually the credentials: one click away for whoever may edit
        // the system, a pointer to an admin for everyone else.
        const cause = `${HEALTH_LABEL[r.status as keyof typeof HEALTH_LABEL] ?? labelOf(r.status)}${r.message ? `: ${r.message}` : ""}`;
        toast.error(cause, can("manage_systems")
          ? { action: { label: "Update credentials", onClick: () => setEditOpen(true) } }
          : { description: "Ask an admin to update the credentials." });
      }
      refresh();
    },
    onError: (e) => toast.error(apiErrorMessage(e) || "Connection test failed"),
  });
  const testLabel = test.isPending
    ? "Testing"
    : test.isError || (test.data && test.data.status !== "healthy")
      ? "Test failed, retry"
      : test.data
        ? "Connection tested"
        : "Test connection";
  const analyse = useMutation({
    mutationFn: () => analyseVersion((latest ?? versions[0])!.id),
    onSuccess: () => { toast.success("Analysis started"); setConfirmAnalyse(false); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (systemsQ.isLoading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton height={56} />
        <div className="m-stat-grid">{[0, 1, 2, 3].map((i) => <Skeleton key={i} height={88} />)}</div>
        <Skeleton height={240} />
      </div>
    );
  }
  if (systemsQ.isError) {
    return <ErrorState {...apiErrorState(systemsQ.error)} onRetry={() => systemsQ.refetch()} />;
  }
  if (!system) {
    return (
      <EmptyState
        title="System not found"
        detail="It may have been removed, or the link is out of date. Pick a system from the list."
        action={<Button variant="secondary" render={<Link href="/systems">Open systems</Link>} />}
      />
    );
  }

  const openExtract = () => setExtractOpen(true);
  const analysable = latest ?? versions[0];
  // Until the connection is known to work, testing it is the next step, not extracting from it.
  const testFirst = system.health_status !== "healthy" && can("trigger_sync");
  const runsExport = [{ format: "xlsx" as const, label: "Runs (.xlsx)", run: () => exportRuns("xlsx", { system_id: systemId }) }];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={system.name}
        status={<Pill tone="neutral">{system.role === "target" ? "Target system" : "Source system"}</Pill>}
        meta={`${[systemTypeLabel(system.system_type), system.environment, system.host].filter(Boolean).join(", ")}. Pull data from this system with Extract, then analyse it to score its objects`}
        secondary={
        <>
          {can("manage_systems") ? <Button variant="ghost" onClick={() => setEditOpen(true)}>Edit</Button> : null}
          {can("analyse") ? (
            <Button variant="secondary" disabled={analyse.isPending || !analysable} onClick={() => setConfirmAnalyse(true)}>
              Analyse
            </Button>
          ) : null}
          <ExportMenu options={versions.length === 0 ? emptyExportOptions(runsExport) : runsExport} />
        </>
        }
        more={[
          ...(can("manage_systems") ? [{ label: "Edit", onSelect: () => setEditOpen(true) }] : []),
          ...(can("analyse") ? [{ label: "Analyse", onSelect: () => setConfirmAnalyse(true), disabled: analyse.isPending || !analysable }] : []),
          { label: "Export runs (.xlsx)", onSelect: () => void exportRuns("xlsx", { system_id: systemId }), disabled: versions.length === 0 },
        ]}
        actions={
        <>
          {can("trigger_sync") ? <Button variant={testFirst ? "primary" : "secondary"} disabled={test.isPending} onClick={() => test.mutate()}>{testLabel}</Button> : null}
          <GatedPrimary kind="extract" allowed={can("trigger_sync")} variant={testFirst ? "secondary" : "primary"} systemId={systemId} scopeLabel={system.name} data-tour="system-extract"
            onClick={openExtract}>
            Extract
          </GatedPrimary>
        </>
        }
      />
      {analysable ? (
        <ConfirmDialog
          open={confirmAnalyse}
          onOpenChange={setConfirmAnalyse}
          title={`Analyse ${systemScope(system)}`}
          body={`Runs every rule over the ${analysable.objects.length.toLocaleString()} ${analysable.objects.length === 1 ? "object" : "objects"} of the run from ${formatDate(analysable.run_at, "datetime")}, as already extracted. ${READ_ONLY}`}
          confirmLabel="Analyse"
          cancelLabel="Not now"
          pending={analyse.isPending}
          onConfirm={() => analyse.mutate()}
        />
      ) : null}

      {extractAsked && !permsLoading && !can("trigger_sync") ? (
        // A link asked for the Extract drawer, which this role cannot open: say why instead of opening nothing.
        <Notice
          tone="info"
          title={`You cannot extract from ${system.name}`}
          action={<GatedPrimary kind="extract" allowed={false} variant="secondary" systemId={systemId} scopeLabel={system.name}>Extract</GatedPrimary>}
        >
          Extraction needs the {primaryRole("extract")} role on this system. Request access to extract from it.
        </Notice>
      ) : null}

      {versionsQ.data?.download?.status === "running" || versionsQ.data?.download?.status === "queued" ? (
        <Notice tone="info">
          Extraction in progress.
          {versionsQ.data.download.table ? (
            <>
              {" "}Reading <Mono>{versionsQ.data.download.table}</Mono>.
            </>
          ) : null}
          {versionsQ.data.download.percent != null ? ` ${versionsQ.data.download.percent} of 100 percent done.` : null}
        </Notice>
      ) : null}

      <div className="m-stat-grid">
        {/* Runs can exist without an extraction (uploads); "nothing extracted" must not sit beside their score. */}
        <Stat label="Health" value={HEALTH_LABEL[system.health_status]} hint={healthHint(system, versions.length > 0)} href={`/systems/${systemId}?tab=health`} />
        <Stat
          label="Objects loaded"
          loading={modulesQ.isLoading}
          value={objectsLoaded(modules, versions[0]).value}
          hint={objectsLoaded(modules, versions[0]).hint}
          href={`/systems/${systemId}?tab=objects`}
        />
        <Stat
          label="Score"
          help="dqs"
          loading={versionsQ.isLoading}
          delta={dqsTrend(versions) != null && Math.abs(dqsTrend(versions) ?? 0) >= 0.05 ? <Delta value={dqsTrend(versions) ?? 0} run="the previous run" /> : undefined}
          // The ring carries the number, as on the run page; no second numeral beside it.
          value={dqs === null ? "—" : aggQ.data ? <DqsScore agg={aggQ.data} versionId={latest?.id} /> : <Score value={dqs} />}
          href={latest ? findingsHref(latest.id) : undefined}
        />
        <Stat label="Open findings" loading={versionsQ.isLoading || aggQ.isLoading} value={latest ? aggQ.data?.total ?? "—" : "—"} href={latest ? findingsHref(latest.id) : undefined} />
      </div>

      <Tabs
        value={initialTab}
        onValueChange={(tab) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set("tab", tab);
          router.replace(`/systems/${systemId}?${params.toString()}`, { scroll: false });
        }}
        items={[
          { value: "overview", label: "Overview", content: <Overview systemId={systemId} versions={versions} modules={modules} latest={latest} canSync={can("trigger_sync")} canAnalyse={can("analyse")} onExtract={openExtract} /> },
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
          {
            value: "runs",
            label: "Runs",
            content: <Runs versions={versions} loading={versionsQ.isLoading} canSync={can("trigger_sync")} onExtract={openExtract} />,
          },
          {
            value: "health",
            label: "Health",
            content: (
              <Health id={systemId} system={system} canSync={can("trigger_sync")} canManage={can("manage_systems")} onChanged={refresh} test={test} testLabel={testLabel} />
            ),
          },
          { value: "config", label: "Configuration", content: <ConfigurationTab systemId={systemId} canPropose={can("trigger_sync")} /> },
          { value: "custom", label: "Custom objects", content: <CustomObjectsTab systemId={systemId} /> },
          { value: "pilot", label: "Pilot", content: <PilotTab id={systemId} /> },
          ...entityTabs({ entityType: "systems", entityId: systemId, canExport: can("export") }),
        ]}
      />

      {can("trigger_sync") ? (
        <Drawer open={extractOpen} onOpenChange={setExtractOpen} title={`Extract from ${system.name}`}>
          <ScopePicker id={systemId} system={system} initialObjects={searchParams.getAll("object")} onDownloaded={(jobId) => { setAwaitedJobId(jobId); setExtractOpen(false); refresh(); }} />
        </Drawer>
      ) : null}

      {/* Edit (and Remove system inside it) is for manage_systems only, like the Edit button. */}
      {can("manage_systems") ? (
        <Drawer open={editOpen} onOpenChange={setEditOpen} title={`Edit ${system.name}`}>
          <EditForm
            system={system}
            targets={(systemsQ.data ?? []).filter((s) => s.role === "target" && s.id !== system.id)}
            onDone={() => { setEditOpen(false); refresh(); }}
            onDeleted={() => { setEditOpen(false); refresh(); router.push("/systems"); }}
          />
        </Drawer>
      ) : null}
    </div>
  );
}

/* ── Overview ──────────────────────────────────────────────────────────── */

const VERDICT_BAR: Record<Verdict | "none", string> = {
  go: "[border-left-color:var(--m-go)]",
  "at-risk": "[border-left-color:var(--m-at-risk)]",
  "no-go": "[border-left-color:var(--m-no-go)]",
  none: "[border-left-color:var(--m-line)]",
};

interface ObjectRow {
  module: string;
  name: string;
  records: number;
  affected: number;
  score: number | null;
  verdict: Verdict | null;
  summary: ObjectSummary | undefined;
}

/** A system's objects ranked by records (then by records affected), each with the verdict of its latest analysed run. */
function rankObjects(modules: SystemModule[], latest: SystemVersion | null, summaries: ObjectSummary[]): ObjectRow[] {
  const byModule = new Map(summaries.map((o) => [o.module, o]));
  const rows = modules.filter((m) => m.enabled).map((m): ObjectRow => {
    const summary = byModule.get(m.module);
    const dqs = latest?.dqs?.[m.module];
    return {
      module: m.module,
      name: formatModuleName(m.module),
      records: Math.max(m.row_count, latest?.records?.[m.module] ?? 0),
      affected: summary?.affected_records ?? 0,
      score: summary?.composite_score ?? (typeof dqs === "number" ? dqs : null),
      verdict: toVerdict(summary?.readiness) ?? null,
      summary,
    };
  });
  return rows.sort((a, b) => b.records - a.records || b.affected - a.affected || a.name.localeCompare(b.name));
}

function Overview({ systemId, modules, versions, latest, canSync, canAnalyse, onExtract }: {
  systemId: string; modules: SystemModule[]; versions: SystemVersion[]; latest: SystemVersion | null; canSync: boolean; canAnalyse: boolean; onExtract: () => void;
}) {
  const router = useRouter();
  const objectsQ = useQuery({
    queryKey: queryKeys.objects(latest?.id ?? ""),
    queryFn: () => getObjects(latest!.id),
    enabled: !!latest,
  });
  const rows = useMemo(() => rankObjects(modules, latest, objectsQ.data?.objects ?? []), [modules, latest, objectsQ.data]);
  const [picked, setPicked] = useUrlState("object", "");
  const selected = rows.find((r) => r.module === picked) ?? rows[0];

  const scored = versions.filter((v) => meanDqs(v) !== null).slice(0, 12).reverse();
  // Ticks are dates (with the time when two runs share a day); the run id is the key so a click opens the right run.
  const tickOf = runAxisTicks(scored.map((v) => ({ id: v.id, run_at: v.run_at })));
  const byRows = [...modules].filter((m) => m.row_count > 0).sort((a, b) => b.row_count - a.row_count).slice(0, 12);
  const runCols = useMemo(() => runColumns(), []);
  // Every "Extract" in an empty state opens the one Extract drawer.
  const extract = canSync ? <Button onClick={onExtract}>Extract</Button> : undefined;
  return (
    <div className="flex flex-col [gap:var(--m-section-gap)]">
      {rows.length ? (
        <div className="grid items-start [gap:var(--m-section-gap)] @5xl:grid-cols-[400px_minmax(0,1fr)]" data-testid="system-workbench">
          <Card title="Objects" meta={`${rows.length.toLocaleString()} by records`} padding="sm">
            <ul className="flex max-h-[560px] flex-col overflow-y-auto" aria-label="Objects of this system, ranked by records">
              {rows.map((r) => (
                <li key={r.module}>
                  <button
                    type="button"
                    aria-pressed={r.module === selected?.module}
                    onClick={() => setPicked(r.module)}
                    className={clsx(
                      "flex w-full items-center gap-3 px-3 py-2 text-left [border-left:3px_solid] [border-bottom:1px_solid_var(--m-line)]",
                      "hover:[background:var(--m-sheet-raised)] aria-pressed:[background:var(--m-accent-soft)]",
                      VERDICT_BAR[r.verdict ?? "none"],
                    )}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="m-text-body m-ink truncate">{r.name}</span>
                      <span className="m-text-meta m-ink-3 m-numeric">{r.records > 0 ? `${r.records.toLocaleString()} records` : "Not loaded"}</span>
                    </span>
                    {r.verdict ? <Status kind="verdict" value={r.verdict} /> : <Pill tone="neutral">Not analysed</Pill>}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {selected ? <ObjectSummaryPane row={selected} latest={latest} systemId={systemId} canSync={canSync} canAnalyse={canAnalyse} onExtract={onExtract} /> : null}
        </div>
      ) : null}
      <div className="grid [gap:var(--m-section-gap)] @5xl:grid-cols-2">
        <Card title="Score per run" meta="Mean of the objects, newest twelve runs">
          {scored.length < 2 ? (
            <EmptyState
              title="No trend yet"
              detail="Two analysed runs are needed to draw a trend."
              action={extract}
            />
          ) : (
            <Line
              height={160}
              data={scored.map((v) => ({ x: v.id, label: tickOf.get(v.id), y: Number((meanDqs(v) ?? 0).toFixed(1)), runId: v.id }))}
              label="Score per run"
              onPointClick={(p) => { if (p.runId) router.push(runPageHref(p.runId)); }}
            />
          )}
        </Card>
        <Card title="Objects by records" meta="Twelve largest">
          {!byRows.length ? (
            <EmptyState
              title="No rows loaded yet"
              detail="Extract an object to see how many rows it holds."
              action={extract}
            />
          ) : (
            <Bar
              height={160}
              data={byRows.map((m) => ({ x: formatModuleName(m.module), y: m.row_count }))}
              onPointClick={(p) => {
                const m = byRows.find((b) => formatModuleName(b.module) === p.x);
                if (m) router.push(`/objects/${m.module}`);
              }}
            />
          )}
        </Card>
      </div>
      <TrendPanel systemId={systemId} />
      <Card title="Last 5 runs">
        {versions.length ? (
          <DataTable columns={runCols} data={versions.slice(0, 5)} getRowId={(v) => v.id} onRowClick={(v) => router.push(`/runs/${v.id}`)} />
        ) : (
          <EmptyState
            title="Nothing extracted yet"
            detail="Extract to create the first run."
            action={extract}
          />
        )}
      </Card>
    </div>
  );
}

/**
 * The selected object: its score, the rule holding it down, its last run, and the one action.
 * Not analysed yet, the one action sits in the empty state: Analyse when it has records (on the Objects tab,
 * where the per-object Analyse is), else Extract, which opens the Extract drawer.
 */
function ObjectSummaryPane({ row, latest, systemId, canSync, canAnalyse, onExtract }: {
  row: ObjectRow; latest: SystemVersion | null; systemId: string; canSync: boolean; canAnalyse: boolean; onExtract: () => void;
}) {
  const s = row.summary;
  const analysed = row.score !== null && latest !== null;
  const href = analysed ? `/objects/${row.module}?run=${latest.id}` : `/objects/${row.module}`;
  const objectsTab = `/systems/${systemId}?tab=objects`;
  const nextStep = row.records > 0
    ? (canAnalyse ? <Button render={<Link href={objectsTab}>Analyse</Link>} /> : undefined)
    : (canSync ? <Button onClick={onExtract}>Extract</Button> : undefined);
  return (
    <Card
      title={row.name}
      meta={row.records > 0 ? `${row.records.toLocaleString()} records` : "Not loaded"}
      actions={analysed ? <Button render={<Link href={href}>Open object</Link>} /> : undefined}
    >
      {analysed ? (
        <dl className="grid grid-cols-2 items-start gap-x-6 gap-y-4 @3xl:grid-cols-4" data-testid="object-summary">
          <div className="flex flex-col gap-1">
            <dt className="m-text-label m-ink-3">Score</dt>
            <dd><Score value={row.score} /></dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="m-text-label m-ink-3">Verdict</dt>
            <dd>{row.verdict ? <Status kind="verdict" value={row.verdict} /> : "—"}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="m-text-label m-ink-3">Blocking rule</dt>
            <dd className="m-text-body">
              {s?.blocking_rule_id ? (
                <><Mono>{s.blocking_rule_id}</Mono>{s.blocking_rule_name ? <span className="m-ink-2"> {s.blocking_rule_name}</span> : null}</>
              ) : s && s.failing_checks === 0 ? "None" : "—"}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="m-text-label m-ink-3">Last run</dt>
            <dd className="m-text-body">
              <DrillLink href={findingsHref(latest.id, row.module)}>{when(latest.analysed_at ?? latest.run_at)}</DrillLink>
            </dd>
          </div>
          {s ? (
            <div className="flex flex-col gap-1">
              <dt className="m-text-label m-ink-3">Failing rules</dt>
              <dd className="m-text-body m-numeric"><DrillLink href={findingsHref(latest.id, row.module)}>{s.failing_checks.toLocaleString()}</DrillLink></dd>
            </div>
          ) : null}
          {s ? (
            <div className="flex flex-col gap-1">
              {/* Summed over the failing rules (api/routes/objects.py), so a record failing two rules counts twice. */}
              <dt className="m-text-label m-ink-3">Rule failures</dt>
              <dd className="m-text-body m-numeric"><DrillLink href={`/objects/${row.module}?run=${latest.id}&tab=records`}>{s.affected_records.toLocaleString()}</DrillLink></dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <EmptyState
          title="Not analysed yet"
          detail={row.records > 0 ? "Run an analysis to score this object." : "Extract this object to score it."}
          action={nextStep}
        />
      )}
    </Card>
  );
}

/* ── Objects ───────────────────────────────────────────────────────────── */

type ObjectAction = { kind: "extract"; module: string } | { kind: "analyse"; module: string; versionId: string } | null;
/** Why an object row's action is off, as its tooltip says it. */
const EXTRACT_DISABLED_REASON = "This object is turned off for this system, so it is not extracted. Ask an administrator to turn it on";
const ANALYSE_DISABLED_REASON = "No finished extraction of this object to analyse yet. Extract it first";

function Objects({ id, system, modules, versions, canSync, canAnalyse, onChanged }: {
  id: string;
  system: SAPSystemExtended;
  modules: SystemModule[];
  versions: SystemVersion[];
  canSync: boolean;
  canAnalyse: boolean;
  onChanged: () => void;
}) {
  const router = useRouter();
  const latest = latestDqs(versions).version;
  const [action, setAction] = useState<ObjectAction>(null);
  const again = useMutation({
    mutationFn: (module: string) => startDownload(id, { objects: [module], scope: {}, analyse: false }),
    onSuccess: () => { toast.success("Extraction started"); setAction(null); onChanged(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const run = useMutation({
    mutationFn: (versionId: string) => analyseVersion(versionId),
    onSuccess: () => { toast.success("Analysis started"); setAction(null); onChanged(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const rankedModules = useMemo(() => [...modules].sort((a, b) => b.row_count - a.row_count || a.module.localeCompare(b.module)), [modules]);
  const columns = useMemo<ColumnDef<SystemModule>[]>(() => [
    {
      id: "module",
      header: "Object",
      // Carry the run whose score this page shows. Without it the object page resolves its own
      // newest run - possibly another system's - so the same row opened on two tabs showed two runs.
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2">
          <Link href={`/objects/${row.original.module}${latest?.id ? `?run=${latest.id}` : ""}`} className="underline">{formatModuleName(row.original.module)}</Link>
          <PreviewBadge sources={row.original.preview_sources} />
        </span>
      ),
    },
    { id: "enabled", header: "Enabled", cell: ({ row }) => (row.original.enabled ? "Yes" : "No") },
    { id: "rows", header: "Records", cell: ({ row }) => <DrillLink href={`/objects/${row.original.module}${latest?.id ? `?run=${latest.id}` : ""}`}>{row.original.row_count.toLocaleString()}</DrillLink> },
    { id: "synced", header: "Last extracted", cell: ({ row }) => when(row.original.last_synced_at) },
    {
      id: "dqs",
      header: "Score",
      cell: ({ row }) => {
        const d = latest?.dqs?.[row.original.module];
        return typeof d === "number" && latest ? (
          <Score size="sm" value={d}><DrillLink href={findingsHref(latest.id, row.original.module)}>{d.toFixed(1)}</DrillLink></Score>
        ) : "—";
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
              !row.original.enabled ? (
                <Tooltip label={EXTRACT_DISABLED_REASON} render={<Button variant="secondary" disabled aria-disabled="true" aria-label={`Extract again. ${EXTRACT_DISABLED_REASON}`} />}>
                  Extract again
                </Tooltip>
              ) : (
                <Button
                  variant="secondary"
                  disabled={again.isPending}
                  onClick={(e) => { e.stopPropagation(); setAction({ kind: "extract", module: m }); }}
                >
                  Extract again
                </Button>
              )
            ) : null}
            {canAnalyse ? (
              !version ? (
                <Tooltip label={ANALYSE_DISABLED_REASON} render={<Button variant="ghost" disabled aria-disabled="true" aria-label={`Analyse. ${ANALYSE_DISABLED_REASON}`} />}>
                  Analyse
                </Tooltip>
              ) : (
                <Button
                  variant="ghost"
                  disabled={run.isPending}
                  onClick={(e) => { e.stopPropagation(); setAction({ kind: "analyse", module: m, versionId: version.id }); }}
                >
                  Analyse
                </Button>
              )
            ) : null}
          </div>
        );
      },
    },
  ], [again, run, canSync, canAnalyse, latest, versions]);
  const scope = systemScope(system);
  return (
    <div className="flex flex-col [gap:var(--m-section-gap)]">
      {modules.length ? (
        <DataTable columns={columns} data={rankedModules} getRowId={(m) => m.module} onRowClick={(m) => router.push(`/objects/${m.module}`)} />
      ) : (
        <EmptyState
          title="No objects yet"
          detail="Meridian lists a system's objects once it has read the system's design. Start that from the Health tab."
          action={<Button render={<Link href={`/systems/${id}?tab=health`}>Go to Health</Link>} />}
        />
      )}
      <ConfirmDialog
        open={action?.kind === "extract"}
        onOpenChange={(o) => { if (!o) setAction(null); }}
        title={`Extract ${action ? formatModuleName(action.module) : ""} again from ${scope}`}
        body={`Reads every table of ${action ? formatModuleName(action.module) : "this object"} in full, with no organisational filter, into a new run. ${READ_ONLY}`}
        confirmLabel="Extract now"
        cancelLabel="Not now"
        pending={again.isPending}
        onConfirm={() => { if (action?.kind === "extract") again.mutate(action.module); }}
      />
      <ConfirmDialog
        open={action?.kind === "analyse"}
        onOpenChange={(o) => { if (!o) setAction(null); }}
        title={`Analyse ${action ? formatModuleName(action.module) : ""} from ${scope}`}
        body={`Runs every rule over ${action ? formatModuleName(action.module) : "this object"} as already extracted, with its latest run as the scope. ${READ_ONLY}`}
        confirmLabel="Analyse"
        cancelLabel="Not now"
        pending={run.isPending}
        onConfirm={() => { if (action?.kind === "analyse") run.mutate(action.versionId); }}
      />
    </div>
  );
}

/* ── Runs ──────────────────────────────────────────────────────────────── */

function Runs({ versions, loading, canSync, onExtract }: { versions: SystemVersion[]; loading: boolean; canSync: boolean; onExtract: () => void }) {
  const router = useRouter();
  const { systemId } = useParams<{ systemId: string }>();
  const columns = useMemo(() => runColumns(systemId), [systemId]);
  if (loading) return <Skeleton height={240} />;
  if (!versions.length) {
    return (
      <EmptyState
        title="Nothing extracted yet"
        detail="Run an extraction to create the first run."
        action={canSync ? <Button onClick={onExtract}>Extract</Button> : undefined}
      />
    );
  }
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

function Health({ id, system, canSync, canManage, onChanged, test, testLabel }: {
  id: string;
  system: { name: string; environment: string; health_status: keyof typeof HEALTH_LABEL; health_message: string | null; last_health_check: string | null; discovery_status?: string | null; system_type: SystemType };
  canSync: boolean;
  canManage: boolean;
  onChanged: () => void;
  test: { isPending: boolean; mutate: () => void };
  testLabel: string;
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
  const discoveryStatus = design?.discovery_status ?? system.discovery_status;

  const discover = useMutation({
    mutationFn: () => discoverSystem(id),
    onSuccess: () => { toast.success("Discovery started"); onChanged(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const verdict = system.health_status === "healthy"
    ? `The connection is healthy${system.last_health_check ? `, checked ${relativeTime(system.last_health_check)}` : ""}.`
    : `The connection is ${HEALTH_LABEL[system.health_status].toLowerCase()}${system.health_message ? `: ${system.health_message}` : ""}.`;

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Connection"
        dataTour="system-connection"
        actions={
          <>
            {canSync ? <Button variant="secondary" disabled={test.isPending} onClick={() => test.mutate()}>{testLabel}</Button> : null}
            {canSync ? (
              <Button variant="secondary" disabled={discover.isPending || running} onClick={() => discover.mutate()}>
                {running ? "Discovering" : snap ? "Discover again" : "Discover design"}
              </Button>
            ) : null}
          </>
        }
      >
        <p className="m-text-body m-ink-2">{verdict}</p>
        <dl className="mt-2 grid grid-cols-2 gap-2 m-text-body">
          <Field label="Last health check"><span>{when(system.last_health_check, "Never")}</span></Field>
          <Field label="Design discovery"><span>{discoveryStatus ? <Status kind="lifecycle" value={discoveryStatus} /> : "Never run"}</span></Field>
          <Field label="SAP release"><Mono>{design?.sap_release ?? "Unknown"}</Mono></Field>
        </dl>
        {snap?.error ? (
          <Notice tone="warning">Discovery {labelOf(snap.status)}: {snap.error}</Notice>
        ) : null}
      </Card>

      {/* The one Configuration home: its own Load button lives on the panel, nowhere else. */}
      <ConfigLoadPanel systemId={id} systemType={system.system_type} system={system} canLoad={canSync} />
      <SchedulesPanel id={id} canManage={canManage} />
      {canManage ? <ReferencePanel id={id} /> : null}

      {!snap ? (
        <Card title="Design discovery">
          <EmptyState
            title="Not discovered yet"
            detail="Discovery reads this system's tables, fields and configuration, so Meridian knows what to extract and check."
            action={canSync ? <Button variant="secondary" disabled={discover.isPending || running} onClick={() => discover.mutate()}>Discover design</Button> : undefined}
          />
        </Card>
      ) : (
          <Tabs
            value={part}
            onValueChange={setPart}
            items={[
              { value: "tables", label: "Data dictionary", content: <TablesTab id={id} /> },
              { value: "config", label: "Configuration tables", content: design ? <ConfigTab id={id} tables={design.configuration} /> : null },
              { value: "coverage", label: "Coverage", content: <CoverageTab id={id} /> },
              { value: "snapshots", label: "History", content: <SnapshotsTab id={id} /> },
            ]}
          />
      )}
    </div>
  );
}

/* ── Edit ──────────────────────────────────────────────────────────────── */

/** The edit form's values from the stored system. Stored secrets are never shown, so they start empty ("Unchanged"). */
const editValues = (s: SAPSystemExtended): ConnectionValues => ({
  name: s.name, system_type: s.system_type, environment: s.environment, auth_type: authFor(s.system_type, s.auth_type),
  host: s.host ?? "", client: s.client ?? "", sysnr: s.sysnr ?? "", username: s.username ?? "", password: "",
  base_url: s.base_url ?? "", token_url: s.token_url ?? "", company_id: s.company_id ?? "", client_id: "", client_secret: "", api_key: "",
});

function EditForm({ system, targets, onDone, onDeleted }: {
  system: SAPSystemExtended;
  targets: { id: string; name: string }[];
  onDone: () => void;
  onDeleted: () => void;
}) {
  const [v, setV] = useState<ConnectionValues>(() => editValues(system));
  const [description, setDescription] = useState(system.description ?? "");
  const [active, setActive] = useState(system.is_active);
  const [role, setRole] = useState<"source" | "target">(system.role);
  const [target, setTarget] = useState<string>(system.target_system_id ?? "none");
  const [confirming, setConfirming] = useState(false);
  // The connect dialog's rules, with every secret optional: an empty secret keeps the stored one.
  const type = system.system_type;
  const rfc = RFC_TYPES.includes(type);
  const auth = authFor(type, v.auth_type);
  const schema = useMemo(() => schemaFor(type, auth, { secretsOptional: true }), [type, auth]);
  const form = useFormErrors(schema, v);
  const update = (patch: Partial<ConnectionValues>) => setV((cur) => ({ ...cur, ...patch }));
  const bind = (key: keyof ConnectionValues) => ({
    value: v[key], onChange: (e: { target: { value: string } }) => update({ [key]: e.target.value }), onBlur: () => form.blur(key),
  });
  /** The connection as edited: the user is always sent (empty clears it), and so is a cloud token URL ("" clears it). */
  const draft = () => {
    const { connection, credentials } = connectionOf(v);
    return { connection: { ...connection, username: v.username.trim(), ...(rfc ? {} : { token_url: v.token_url.trim() }) }, credentials };
  };
  const profilesQ = useQuery({ queryKey: queryKeys.syncProfiles(system.id), queryFn: () => getSyncProfiles(system.id) });
  const schedules = profilesQ.data?.length;

  // Test before save: the edited fields are tried as they stand, the stored secret standing in for one left empty.
  // The result is kept with the values it tried; once a connection field changes it is marked out of date.
  const [outcome, setOutcome] = useState<{ value: TestOutcomeValue; key: string } | null>(null);
  const currentKey = connectionKey(v);
  const blocked = testBlockedHint(form.errors, type);
  // The variable is the connection key the test ran with, so its outcome can tell when it goes out of date.
  const test = useMutation<TestConnectionResponse, unknown, string>({
    mutationFn: () => {
      const { connection, credentials } = draft();
      return testEditedConnection(system.id, { name: v.name.trim(), system_type: type, environment: v.environment, ...connection, credentials });
    },
    onMutate: () => setOutcome(null),
    onSuccess: (r, key) => setOutcome({ value: r, key }),
    onError: (e, key) => setOutcome({ value: { failed: apiErrorMessage(e) }, key }),
  });
  const save = useMutation({
    mutationFn: () => {
      const { connection, credentials } = draft();
      return updateSystem(system.id, {
        name: v.name.trim(), environment: v.environment, description, is_active: active, role,
        ...(role === "source" ? { target_system_id: target === "none" ? "" : target } : {}),
        ...connection,
        ...(Object.keys(credentials).length ? { credentials } : {}),
      });
    },
    onSuccess: () => { toast.success("System saved"); onDone(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => deleteSystem(system.id),
    onSuccess: () => { toast.success(`${system.name} removed`); onDeleted(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => { e.preventDefault(); form.touchAll(); if (form.valid) save.mutate(); }}
    >
      <Field label="Name" error={form.error("name")}>
        <Input {...bind("name")} />
      </Field>
      <Field label="Environment">
        <Select
          value={v.environment}
          onValueChange={(env) => update({ environment: env })}
          options={ENVIRONMENTS}
        />
      </Field>
      <Field label="Role">
        <Select
          value={role}
          onValueChange={(r) => setRole(r === "target" ? "target" : "source")}
          options={[{ value: "source", label: "Source" }, { value: "target", label: "Target" }]}
        />
      </Field>
      {role === "source" ? (
        <Field label="Target">
          <Select
            value={target}
            onValueChange={setTarget}
            options={[{ value: "none", label: "None (SAP standard baseline)" }, ...targets.map((t) => ({ value: t.id, label: t.name }))]}
          />
        </Field>
      ) : null}
      <Field label="Description">
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <label className="flex items-center gap-2 m-text-body">
        <Checkbox aria-label="Active" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active
      </label>

      <fieldset className="flex flex-col gap-3 border-t pt-4 [border-color:var(--m-line)]">
        <legend className="m-text-body font-semibold m-ink">Connection and credentials</legend>
        <p className="m-text-meta m-ink-3">Stored secrets are never shown. Leave a secret empty to keep the stored one; re-enter the password/secret when you change the host.</p>
        <ConnectionFields v={v} bind={bind} error={form.error} onAuthChange={(a) => update({ auth_type: a })} secretPlaceholder="Unchanged" />
        {outcome ? <TestOutcome outcome={outcome.value} stale={outcome.key !== currentKey} /> : null}
        <div className="flex flex-col gap-1">
          <div>
            <Button type="button" variant="secondary" pending={test.isPending} disabled={blocked !== null} onClick={() => test.mutate(currentKey)}>
              Test connection
            </Button>
          </div>
          {blocked ? <p className="m-text-meta m-ink-3">{blocked}</p> : null}
        </div>
      </fieldset>

      <div className="flex gap-2">
        <Button type="submit" pending={save.isPending}>Save</Button>
        <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>Remove system</Button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        tone="danger"
        title={`Remove ${system.name}?`}
        typeToConfirm={system.name}
        body={`${schedules == null ? "Its credentials and schedules" : `Its credentials and ${schedules.toLocaleString()} ${schedules === 1 ? "schedule" : "schedules"}`} go with it. Extracted runs and findings stay.`}
        confirmLabel="Remove system"
        cancelLabel="Keep"
        pending={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </form>
  );
}

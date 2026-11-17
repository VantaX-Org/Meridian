"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { useUrlParam } from "@/lib/v2/hooks";
import { useTimeline } from "@/lib/v2/runs-queries";
import type { TimelineRun } from "@/lib/api/v2/runs";
import { archiveRuns, getJobsList, getSystemsExtended, restoreRuns, retryJobById } from "@/lib/api/v2/runs";
import { cancelJob, exportRuns } from "@/lib/api/v2/run-ops";
import { streamJobs } from "@/lib/api/jobs";
import { useCompareSets, useRunsPage, type RunStatusFilter } from "@/lib/api/next/runs";
import type { Job } from "@/types/jobs";
import {
  Button, Card, Chip, Confirm, DataTable, EmptyState, ErrorState, FieldChip, Field, PageHeader, Select, Skeleton, Tabs,
  useAletheiaScope, useSheet, useToast, type Column,
} from "@/ui/kit";
import type { VersionHead } from "@/lib/api/v2/runs";
import { answer } from "./answers";
import { JobHairline } from "./JobHairline";
import { isLive, modulesOf, runPath, runScore, runTitle, scoreText, sourceLabel, statusLabel, statusTone, when } from "./util";
import "./runs.css";

const VIEWS = ["runs", "jobs", "sets", "full"] as const;
const PAGE = 50;
const FILTERS: { id: RunStatusFilter | "all"; label: () => string }[] = [
  { id: "all", label: () => t("All runs") },
  { id: "complete", label: () => t("Complete") },
  { id: "failed", label: () => t("Failed") },
  { id: "active", label: () => t("Running") },
];

export const StatusPill = ({ s }: { s: string }) => <span className="rn-pill" data-tone={statusTone(s)}>{statusLabel(s)}</span>;

export const Modules = ({ list }: { list: string[] }) => (
  <span className="rn-chips">{list.map((m) => <FieldChip key={m} code={m} description={moduleText(m)} />)}</span>
);

function RunsView({ onAsk }: { onAsk: (rows: VersionHead[], total: number) => void }) {
  const fx = useFixture();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useUrlParam<RunStatusFilter | "all">("status", "all", ["all", "complete", "failed", "active"]);
  const [system, setSystem] = useState("");
  const [offset, setOffset] = useState(0);
  const [confirm, setConfirm] = useState<"archive" | "restore" | null>(null);
  const systems = useQuery({ queryKey: ["next", "runs", "systems", fx], queryFn: getSystemsExtended });
  const page = useRunsPage({ system_id: system || undefined, status: status === "all" ? undefined : status, limit: PAGE, offset });
  const rows = useMemo(() => page.data?.versions ?? [], [page.data]);
  const total = page.data?.total ?? 0;
  useEffect(() => onAsk(rows, total), [rows, total, onAsk]);

  const run = async (kind: "archive" | "restore") => {
    setConfirm(null);
    try {
      if (kind === "archive") { const r = await archiveRuns(10); toast(t("{n, plural, one {# run archived} other {# runs archived}}", { n: r.archived }), "good"); }
      else { const r = await restoreRuns(); toast(t("{n, plural, one {# run restored} other {# runs restored}}", { n: r.restored }), "good"); }
      qc.invalidateQueries({ queryKey: ["next"] });
    } catch { toast(t("That did not work. Nothing was changed."), "bad"); }
  };
  const doExport = async (format: "csv" | "xlsx") => {
    try { toast(t("Saved {name}", { name: await exportRuns(format, { system_id: system || undefined, status: status === "all" ? undefined : status }) }), "good"); }
    catch { toast(t("The export could not be made."), "bad"); }
  };

  const columns: Column<VersionHead>[] = [
    { key: "run", label: t("Run"), sort: (h) => h.run_number ?? 0, render: (h) => <span className="rn-num">{runTitle(h)}</span> },
    { key: "objects", label: t("Objects"), render: (h) => <Modules list={modulesOf(h)} /> },
    { key: "score", label: t("Score"), align: "end", sort: (h) => runScore(h) ?? -1, render: (h) => <span className="rn-num">{scoreText(runScore(h))}</span> },
    { key: "status", label: t("Status"), sort: (h) => h.status, render: (h) => <StatusPill s={h.status} /> },
    { key: "source", label: t("Source"), render: sourceLabel },
    { key: "when", label: t("Started"), sort: (h) => h.run_at, render: (h) => when(h.run_at) },
  ];

  return (
    <>
      <div className="rn-filters" role="group" aria-label={t("Filter runs")}>
        {FILTERS.map((f) => <Chip key={f.id} selected={status === f.id} onClick={() => { setOffset(0); setStatus(f.id); }}>{f.label()}</Chip>)}
        <Field label={t("System")}>
          <Select value={system} onChange={(e) => { setOffset(0); setSystem(e.target.value); }}
            options={[{ value: "", label: t("All systems") }, ...(systems.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
        </Field>
      </div>
      {page.isLoading ? <Skeleton lines={8} label={t("Loading the runs")} /> : page.isError ? <ErrorState heading={t("The runs could not be loaded")} retryLabel={t("Try again")} onRetry={() => page.refetch()} /> : rows.length === 0 ? (
        <EmptyState heading={t("No runs match")} body={t("Change the filter, or start a run.")} />
      ) : (
        <Card title={t("Runs")} sub={t("{shown} of {total} runs", { shown: rows.length, total })}>
          <DataTable columns={columns} rows={rows} rowKey={(h) => h.id} label={t("Runs")} height={440} onSelect={(h) => router.push(withFixture(runPath(h.id), fx))} />
          <div className="mx-links">
            <Button variant="ghost" onClick={() => setOffset(Math.max(0, offset - PAGE))} disabled={offset === 0}>{t("Newer")}</Button>
            <Button variant="ghost" onClick={() => setOffset(offset + PAGE)} disabled={offset + PAGE >= total}>{t("Older")}</Button>
          </div>
        </Card>
      )}
      <Card title={t("Keep the list tidy")} sub={t("Export what you see, or move older runs out of the way.")}>
        <div className="mx-links">
          <Button variant="secondary" onClick={() => doExport("xlsx")}>{t("Export as Excel")}</Button>
          <Button variant="secondary" onClick={() => doExport("csv")}>{t("Export as CSV")}</Button>
          <Button variant="secondary" onClick={() => setConfirm("archive")}>{t("Archive older runs")}</Button>
          <Button variant="secondary" onClick={() => setConfirm("restore")}>{t("Restore archived runs")}</Button>
        </div>
      </Card>
      <Confirm open={confirm === "archive"} title={t("Archive older runs?")} confirmLabel={t("Archive")} cancelLabel={t("Cancel")} onConfirm={() => run("archive")} onCancel={() => setConfirm(null)}>
        {t("The latest 10 runs stay. Every older run is archived. The baseline run is kept.")}
      </Confirm>
      <Confirm open={confirm === "restore"} title={t("Restore archived runs?")} confirmLabel={t("Restore")} cancelLabel={t("Cancel")} onConfirm={() => run("restore")} onCancel={() => setConfirm(null)}>
        {t("Every archived run comes back into the list.")}
      </Confirm>
    </>
  );
}

const kindText = (k: string): string => {
  const m: Record<string, string> = { extraction: t("Pull from SAP"), analysis: t("Analysis"), upload: t("Cleaned file upload"), config_sync: t("Configuration sync"), config_load: t("Configuration load"), simulation: t("Simulation"), process_discovery: t("Process discovery"), export: t("Export") };
  return m[k] ?? k;
};

function JobsView() {
  const fx = useFixture();
  const toast = useToast();
  const qc = useQueryClient();
  const jobs = useQuery({ queryKey: ["next", "runs", "jobs", fx], queryFn: () => getJobsList(100), refetchInterval: 15_000 });
  useEffect(() => streamJobs(() => qc.invalidateQueries({ queryKey: ["next", "runs", "jobs"] }), () => undefined), [qc]);
  const act = async (j: Job, kind: "retry" | "cancel") => {
    try { await (kind === "retry" ? retryJobById(j.id) : cancelJob(j.id)); toast(kind === "retry" ? t("Job started again") : t("Job cancelled"), "good"); qc.invalidateQueries({ queryKey: ["next", "runs", "jobs"] }); }
    catch { toast(t("That did not work. Nothing was changed."), "bad"); }
  };
  if (jobs.isLoading) return <Skeleton lines={6} label={t("Loading the jobs")} />;
  if (jobs.isError) return <ErrorState heading={t("The jobs could not be loaded")} retryLabel={t("Try again")} onRetry={() => jobs.refetch()} />;
  const list = jobs.data ?? [];
  if (!list.length) return <EmptyState heading={t("No jobs yet")} body={t("Pulls, analyses and uploads show here while they work.")} />;
  const columns: Column<Job>[] = [
    { key: "kind", label: t("Kind"), render: (j) => kindText(j.kind) },
    { key: "label", label: t("Job"), render: (j) => j.label },
    { key: "status", label: t("Status"), render: (j) => <StatusPill s={j.status} /> },
    { key: "progress", label: t("Progress"), align: "end", render: (j) => <span className="rn-num">{j.status === "completed" ? "100%" : `${Math.round(j.percent ?? 0)}%`}</span> },
    { key: "started", label: t("Started"), sort: (j) => j.started_at ?? 0, render: (j) => when(j.started_at ? j.started_at * 1000 : null) },
    { key: "act", label: t("Actions"), render: (j) => (
      <span className="rn-row-actions">
        {j.status === "failed" || j.status === "cancelled" ? <Button variant="ghost" onClick={() => act(j, "retry")}>{t("Retry")}</Button> : null}
        {j.status === "running" || j.status === "queued" ? <Button variant="ghost" onClick={() => act(j, "cancel")}>{t("Cancel")}</Button> : null}
      </span>
    ) },
  ];
  return <Card title={t("Jobs")} sub={t("{n, plural, one {# job} other {# jobs}}", { n: list.length })}><DataTable columns={columns} rows={list} rowKey={(j) => j.id} label={t("Jobs")} height={440} /></Card>;
}

/** Every finished run of the tenant, newest first, with each object's score in that run. */
function TimelineView() {
  const fx = useFixture();
  const q = useTimeline(null, 50);
  const list = [...(q.data?.runs ?? [])].reverse();
  const columns: Column<TimelineRun>[] = useMemo(() => [
    { key: "when", label: t("When"), render: (r) => when(r.run_at), sort: (r) => r.run_at ?? "" },
    { key: "run", label: t("Run"), render: (r) => <a href={withFixture(runPath(r.id), fx)}>{r.label ?? (r.run_number != null ? `#${r.run_number}` : r.id)}</a> },
    { key: "objects", label: t("Objects"), render: (r) => (
      <span className="mx-links">
        {Object.entries(r.objects).map(([code, o]) => <FieldChip key={code} code={code} description={`${moduleText(code)}: ${scoreText(o.score)}${o.capped ? ` ${t("(capped)")}` : ""}`} />)}
      </span>
    ) },
    { key: "records", label: t("Records checked"), render: (r) => (r.records_checked ?? "—"), sort: (r) => r.records_checked ?? 0, align: "end" },
  ], [fx]);
  if (q.isLoading) return <Skeleton lines={6} label={t("Loading the timeline")} />;
  if (q.isError) return <ErrorState heading={t("The timeline could not be loaded")} onRetry={() => void q.refetch()} retryLabel={t("Try again")} />;
  if (!list.length) return <EmptyState heading={t("No finished run yet")} />;
  return <Card title={t("Timeline")} sub={t("Every finished run, newest first.")}><DataTable label={t("Timeline")} rows={list} rowKey={(r) => r.id} columns={columns} /></Card>;
}

function SetsView() {
  const page = useRunsPage({ limit: 30, offset: 0 });
  const runs = page.data?.versions ?? [];
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const v2 = b || runs[0]?.id || "";
  const v1 = a || runs[1]?.id || "";
  const sets = useCompareSets(v1 && v2 ? { v1, v2, limit: 100, offset: 0 } : null);
  const opts = runs.map((h) => ({ value: h.id, label: `${runTitle(h)} (${when(h.run_at)})` }));
  const recs = sets.data?.records ?? [];
  const change = (c: string) => (c === "new" ? t("New") : c === "resolved" ? t("Resolved") : c === "regressed" ? t("Regressed") : t("Persisting"));
  const columns: Column<(typeof recs)[number]>[] = useMemo(() => [
    { key: "change", label: t("Change"), render: (r) => change(r.change) },
    { key: "check", label: t("Rule"), render: (r) => <FieldChip code={r.check_id} description={r.reason ?? undefined} /> },
    { key: "module", label: t("Object"), render: (r) => <FieldChip code={r.module} description={moduleText(r.module)} /> },
    { key: "key", label: t("Record"), render: (r) => <code className="mx-code">{r.record_key}</code> },
  ], []);
  return (
    <>
      <Card title={t("Compare two runs")} sub={t("Pick an earlier and a later run to see which records changed.")}>
        <div className="rn-filters">
          <Field label={t("Earlier run")}><Select value={v1} onChange={(e) => setA(e.target.value)} options={opts} /></Field>
          <Field label={t("Later run")}><Select value={v2} onChange={(e) => setB(e.target.value)} options={opts} /></Field>
        </div>
      </Card>
      {sets.isLoading ? <Skeleton lines={6} label={t("Loading the records")} /> : recs.length === 0 ? <EmptyState heading={t("No changed records")} body={t("These two runs hold the same findings.")} /> : (
        <Card title={t("Changed records")} sub={t("{n, plural, one {# record} other {# records}}", { n: sets.data?.total ?? recs.length })}>
          <DataTable columns={columns} rows={recs} rowKey={(r) => `${r.check_id}/${r.record_key}/${r.change}`} label={t("Changed records")} height={440} />
        </Card>
      )}
    </>
  );
}

export function Runs() {
  useInterfaceLang();
  const fx = useFixture();
  const sheet = useSheet();
  const [view, setView] = useUrlParam<(typeof VIEWS)[number]>("view", "runs", VIEWS);
  const [facts, setFacts] = useState<{ rows: VersionHead[]; total: number }>({ rows: [], total: 0 });
  const onAsk = useMemo(() => (rows: VersionHead[], total: number) => setFacts((f) => (f.rows === rows && f.total === total ? f : { rows, total })), []);

  useAletheiaScope({
    key: "runs",
    label: t("Asking about your runs"),
    suggestions: [t("Which runs failed?"), t("What is the latest score?")],
    answer: (prompt) => {
      const failed = facts.rows.filter((h) => h.status === "failed");
      if (prompt === t("Which runs failed?")) {
        return answer(failed.length ? t("{n, plural, one {# run failed} other {# runs failed}} in the list you see.", { n: failed.length }) : t("No run in the list you see has failed."),
          failed.slice(0, 5).map((h) => `${runTitle(h)} (${when(h.run_at)})`),
          failed[0] ? [{ id: "open", label: t("Open {run}", { run: runTitle(failed[0]) }), href: withFixture(runPath(failed[0].id), fx) }] : []);
      }
      const done = facts.rows.find((h) => h.status === "complete");
      return done
        ? answer(t("{run} scored {score}.", { run: runTitle(done), score: scoreText(runScore(done)) }), [`${runTitle(done)} (${when(done.run_at)})`], [{ id: "open", label: t("Open {run}", { run: runTitle(done) }), href: withFixture(runPath(done.id), fx) }])
        : answer(t("There is no complete run in the list you see."), []);
    },
  });

  return (
    <div className="mx-col">
      <JobHairline />
      <PageHeader title={t("Runs")} context={t("{n, plural, one {# run} other {# runs}}", { n: facts.total })} actions={<Button onClick={() => sheet.open("cycle")}>{t("Start a run")}</Button>} />
      <Tabs idBase="runs-view" label={t("Runs views")} value={view} onChange={(v) => setView(v as (typeof VIEWS)[number])}
        items={[{ id: "runs", label: t("Runs") }, { id: "jobs", label: t("Jobs") }, { id: "sets", label: t("Compare sets") }, { id: "full", label: t("Timeline") }]} />
      <div role="tabpanel" id={`runs-view-panel-${view}`} aria-labelledby={`runs-view-tab-${view}`} className="mx-col">
        {view === "runs" ? <RunsView onAsk={onAsk} /> : view === "jobs" ? <JobsView /> : view === "full" ? <TimelineView /> : <SetsView />}
      </div>
    </div>
  );
}

export { isLive };

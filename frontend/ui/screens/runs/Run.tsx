"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { useUrlParam } from "@/lib/v2/hooks";
import { formatDuration } from "@/lib/format";
import { analyseRun, archiveRuns, cappedReads, getRuleTrend, pinBaseline, restoreRuns } from "@/lib/api/v2/runs";
import { downloadReconciliation, getRunSteps, renameRun, rerunAgents, streamRunEvents, type RunEvent } from "@/lib/api/v2/run-ops";
import { purgeVersion } from "@/lib/api/v2/admin";
import { getConfigMatches } from "@/lib/api/v2/config";
import { MatchSummary, RootCauseSheet } from "./ConfigDetail";
import { exportVersionProfile, getProfile } from "@/lib/api/v2/profile";
import { SplitCapped } from "./SplitCapped";
import { MinedDependencies } from "./MinedDependencies";
import { baselineRefusalOf, getSemanticTypes, putSemanticType, type SemanticColumn, type SemanticType } from "@/lib/api/v2/step9";
import { getRunPrediction } from "@/lib/api/v2/step10";
import { useObjectCycle, useRun, useRunsPage } from "@/lib/api/next/runs";
import {
  Button, Card, Confirm, DataTable, EmptyState, ErrorState, FieldChip, Field, Input, PageHeader, Select, Skeleton, StatTile, CycleStepper, Tabs, TrendArea,
  useAletheiaScope, useSheet, useToast, type Column, ExportMenu } from "@/ui/kit";
import { answer } from "./answers";
import { JobHairline } from "./JobHairline";
import { Modules, StatusPill } from "./Runs";
import { modulesOf, runPath, runScore, runTitle, scoreText, sourceLabel, when } from "./util";
import "./runs.css";

const TABS = ["overview", "profile", "config"] as const;
type Tab = (typeof TABS)[number];
const SEM: SemanticType[] = ["iban", "eu_vat", "email", "url", "date", "phone", "postcode", "country", "currency_amount", "person_name"];

const classText = (c: string) => (c === "data_error" ? t("Data error") : c === "config_deviation" ? t("Configuration deviation") : t("Unclear"));
const secs = (s: number | null) => (s == null ? t("n/a") : formatDuration(s * 1000));

function Cycle({ id, module }: { id: string; module: string }) {
  const { cycle } = useObjectCycle(id, module);
  return <CycleStepper label={t("Cycle steps")} step={cycle?.step ?? null} labels={{ pull: t("Pull"), clean: t("Clean"), upload: t("Upload"), score: t("Re-score"), compare: t("Compare") }} />;
}

function Steps({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["next", "run", id, "steps", useFixture()], queryFn: () => getRunSteps(id) });
  if (q.isLoading) return <Skeleton lines={4} label={t("Loading the steps")} />;
  const steps = q.data?.steps ?? [];
  if (!steps.length) return <EmptyState heading={t("No steps recorded")} body={t("The steps appear when the run starts working.")} />;
  const cols: Column<(typeof steps)[number]>[] = [
    { key: "n", label: t("Step"), render: (s) => <span className="rn-num">{s.step_number}</span> },
    { key: "name", label: t("What it did"), render: (s) => s.step_name },
    { key: "status", label: t("Status"), render: (s) => <StatusPill s={s.status} /> },
    { key: "dur", label: t("Took"), align: "end", render: (s) => <span className="rn-num">{s.duration_ms == null ? t("n/a") : formatDuration(s.duration_ms)}</span> },
    { key: "err", label: t("Problem"), render: (s) => s.error_detail ?? "" },
  ];
  return <Card title={t("Steps")} sub={t("{n, plural, one {# step} other {# steps}}", { n: steps.length })}><DataTable columns={cols} rows={steps} rowKey={(s) => String(s.step_number)} label={t("Steps")} height={280} /></Card>;
}

function Trend({ systemId }: { systemId: string }) {
  const q = useQuery({ queryKey: ["next", "run", "trend", systemId, useFixture()], queryFn: () => getRuleTrend(systemId, 8), enabled: !!systemId });
  const points = useMemo(() => {
    const d = q.data;
    if (!d) return [];
    return d.runs.map((r, i) => {
      const sum = d.rules.reduce((a, x) => a + (x.failing[i] ?? 0), 0);
      return { axis: r.run_number != null ? `#${r.run_number}` : "", title: r.run_at ? when(r.run_at) : "", value: sum };
    });
  }, [q.data]);
  const top = useMemo(() => {
    const d = q.data;
    if (!d) return [];
    const last = d.runs.length - 1;
    return [...d.rules].map((r) => ({ ...r, now: r.failing[last] ?? 0 })).sort((a, b) => b.now - a.now).slice(0, 5);
  }, [q.data]);
  return (
    <Card title={t("Failing records over the last runs")} sub={t("Added up across every rule of this system.")}>
      <TrendArea points={points} label={t("Failing records per run")} emptyLabel={t("No earlier runs to trend yet.")} />
      {top.length ? <div className="mx-links">{top.map((r) => <span key={r.check_id}><FieldChip code={r.check_id} description={moduleText(r.module)} /> <span className="rn-num">{r.now}</span></span>)}</div> : null}
    </Card>
  );
}

function Predict({ systemId, modules }: { systemId: string; modules: string[] }) {
  const q = useQuery({ queryKey: ["next", "run", "predict", systemId, modules.join(","), useFixture()], queryFn: () => getRunPrediction({ system_id: systemId || undefined, modules }) });
  const p = q.data;
  return (
    <Card title={t("What the next run will take")} sub={t("From how earlier runs of these objects went.")}>
      {q.isLoading ? <Skeleton lines={3} label={t("Loading the estimate")} /> : !p || !p.objects.length ? <EmptyState heading={t("No estimate yet")} body={t("Run these objects a few times to get one.")} /> : (
        <>
          <dl className="mx-tiles">
            <StatTile label={t("Expected time")} value={secs(p.total.seconds)} note={t("Between {low} and {high}", { low: secs(p.total.seconds_low), high: secs(p.total.seconds_high) })} />
            <StatTile label={t("Records")} value={p.total.records == null ? t("n/a") : p.total.records.toLocaleString()} />
            <StatTile label={t("Jobs ahead")} value={String(p.queue.waiting)} />
          </dl>
          <div className="mx-links">{p.objects.map((o) => <span key={o.module}><FieldChip code={o.module} description={moduleText(o.module)} /> <span className="rn-num">{secs(o.seconds)}</span></span>)}</div>
        </>
      )}
    </Card>
  );
}

function Activity({ id }: { id: string }) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  useEffect(() => streamRunEvents(id, (e) => setEvents((x) => [...x.slice(-49), e]), () => undefined), [id]);
  return (
    <Card title={t("Activity")} sub={t("Live while the run works.")}>
      {events.length === 0 ? <EmptyState heading={t("Nothing happening")} body={t("Events show here as the run works.")} /> : (
        <ul className="rn-list">{events.map((e, i) => <li key={i}><code className="mx-code">{e.type}</code> {typeof e.data === "string" ? e.data : ""}</li>)}</ul>
      )}
    </Card>
  );
}

function ProfileTab({ id, systemId, modules }: { id: string; systemId: string; modules: string[] }) {
  const fx = useFixture();
  const toast = useToast();
  const qc = useQueryClient();
  const [obj, setObj] = useState(modules[0] ?? "");
  const profile = useQuery({ queryKey: ["next", "run", id, "profile", obj, fx], queryFn: () => getProfile(id, obj), enabled: !!obj });
  const sem = useQuery({ queryKey: ["next", "run", id, "sem", fx], queryFn: () => getSemanticTypes(id) });
  const set = async (c: SemanticColumn, v: string) => {
    try { await putSemanticType(id, c.column, v as SemanticType | "none"); qc.invalidateQueries({ queryKey: ["next", "run", id, "sem"] }); toast(t("Column type saved"), "good"); }
    catch (e) { toast(baselineRefusalOf(e)?.detail ?? t("That did not work. Nothing was changed."), "bad"); }
  };
  const save = (format: string) => exportVersionProfile(systemId, id, obj, format as "csv" | "xlsx");
  const tables = profile.data?.tables ?? [];
  const tcols: Column<(typeof tables)[number]>[] = [
    { key: "table", label: t("Table"), render: (x) => <FieldChip code={x.table} description={moduleText(obj)} /> },
    { key: "rows", label: t("Rows profiled"), align: "end", render: (x) => <span className="rn-num">{x.rows.toLocaleString()}</span> },
    { key: "all", label: t("Rows in table"), align: "end", render: (x) => <span className="rn-num">{x.table_rows.toLocaleString()}</span> },
    { key: "fields", label: t("Fields"), align: "end", render: (x) => <span className="rn-num">{x.fields.length}</span> },
  ];
  const opts = [{ value: "none", label: t("No type") }, ...SEM.map((s) => ({ value: s, label: s }))];
  const scols: Column<SemanticColumn>[] = [
    { key: "col", label: t("Column"), render: (c) => <FieldChip code={c.column} description={c.detected ? t("Looks like {type}", { type: c.detected }) : t("No type detected")} /> },
    { key: "conf", label: t("Confidence"), align: "end", render: (c) => <span className="rn-num">{c.confidence == null ? t("n/a") : `${Math.round(c.confidence * 100)}%`}</span> },
    { key: "conform", label: t("Conforming"), align: "end", render: (c) => <span className="rn-num">{c.conformance == null ? t("n/a") : `${Math.round(c.conformance * 100)}%`}</span> },
    { key: "type", label: t("Type"), render: (c) => <Select aria-label={t("Type of {column}", { column: c.column })} value={c.type ?? "none"} options={opts} onChange={(e) => set(c, e.target.value)} /> },
  ];
  return (
    <div className="mx-col">
      <Card title={t("Profile")} sub={t("What each table of the object holds.")}
        action={<span className="rn-row-actions"><ExportMenu label={t("Export profile")} formats={[{ id: "xlsx", label: t("Excel workbook") }, { id: "csv", label: t("CSV") }]} onExport={save} /></span>}>
        <Field label={t("Object")}><Select value={obj} onChange={(e) => setObj(e.target.value)} options={modules.map((m) => ({ value: m, label: moduleText(m) }))} /></Field>
        {profile.isLoading ? <Skeleton lines={4} label={t("Loading the profile")} /> : tables.length === 0 ? <EmptyState heading={t("No profile for this object")} body={t("The run did not profile it.")} /> : (
          <DataTable columns={tcols} rows={tables} rowKey={(x) => x.table} label={t("Profiled tables")} height={240} />
        )}
      </Card>
      {profile.data ? <MinedDependencies object={obj} deps={profile.data.dependencies} onDone={() => void profile.refetch()} /> : null}
      <Card title={t("Column types")} sub={t("Confirm what each column holds so its values are checked.")}>
        {sem.isLoading ? <Skeleton lines={4} label={t("Loading the column types")} /> : !sem.data?.columns.length ? <EmptyState heading={t("No columns profiled")} body={t("Column types appear once the run is profiled.")} /> : (
          <DataTable columns={scols} rows={sem.data.columns} rowKey={(c) => c.column} label={t("Column types")} height={320} />
        )}
      </Card>
    </div>
  );
}

function ConfigTab({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["next", "run", id, "config", useFixture()], queryFn: () => getConfigMatches(id) });
  const [cause, setCause] = useState<{ id: string; module: string } | null>(null);
  if (q.isLoading) return <Skeleton lines={5} label={t("Loading the configuration matches")} />;
  const items = q.data?.items ?? [];
  if (!items.length) return <EmptyState heading={t("No configuration matches")} body={t("No failing record of this run traces to configuration.")} />;
  const cols: Column<(typeof items)[number]>[] = [
    { key: "cls", label: t("Verdict"), render: (m) => classText(m.classification) },
    { key: "rule", label: t("Rule"), render: (m) => <FieldChip code={m.check_id} description={moduleText(m.module)} /> },
    { key: "field", label: t("Field"), render: (m) => (m.field ? <FieldChip code={m.field} description={m.std_rule_expectation ?? ""} /> : "") },
    { key: "val", label: t("Value found"), render: (m) => m.actual_value ?? "" },
    { key: "evid", label: t("Configuration evidence"), render: (m) => m.config_evidence ?? "" },
    { key: "act", label: t("What to do"), render: (m) => m.recommended_action ?? "" },
  ];
  return (
    <div className="mx-col">
      <Card title={t("What the run's failures trace to")}><MatchSummary id={id} /></Card>
      <Card title={t("Configuration matches")} sub={t("{n, plural, one {# record} other {# records}}", { n: q.data?.total ?? items.length })}>
        <DataTable columns={cols} rows={items} rowKey={(m) => `${m.check_id}/${m.record_key}/${m.field}`} label={t("Configuration matches")} height={400} onSelect={(m) => setCause({ id: m.check_id, module: m.module })} />
      </Card>
      <RootCauseSheet checkId={cause?.id ?? null} module={cause?.module} onClose={() => setCause(null)} />
    </div>
  );
}

export function Run({ id }: { id: string }) {
  useInterfaceLang();
  const fx = useFixture();
  const href = (p: string) => withFixture(p, fx);
  const router = useRouter();
  const params = useSearchParams();
  const sheet = useSheet();
  const toast = useToast();
  const qc = useQueryClient();
  const run = useRun(id);
  const [tab, setTab] = useUrlParam<Tab>("tab", "overview", TABS);
  const [dlg, setDlg] = useState<"rename" | "delete" | "archive" | "restore" | null>(null);
  const [text, setText] = useState("");
  const h = run.data;
  const modules = h ? modulesOf(h) : [];
  const systemId = h?.metadata?.system_id ?? "";
  const focus = modules[0] ?? "";
  // The last five other runs of this system, oldest first, then this run: the multi-run compare link.
  const recent = useRunsPage({ system_id: systemId, limit: 6 }, !!systemId);
  const cmp = [...(recent.data?.versions ?? []).map((v) => v.id).filter((x) => x !== id).slice(0, 5).reverse(), id];
  const opened = params.get("open") === "extract-target";
  useEffect(() => { if (opened && h) sheet.open("extract-target", { run: id }); }, [opened, h, id]); // eslint-disable-line react-hooks/exhaustive-deps

  useAletheiaScope({
    key: `run:${id}`,
    label: h ? t("Asking about {run}", { run: runTitle(h) }) : t("Asking about this run"),
    suggestions: [t("How did this run score?"), t("What should I do next?")],
    answer: (prompt) => {
      if (!h) return answer(t("The run has not loaded yet."), []);
      if (prompt === t("How did this run score?")) {
        return answer(t("{run} scored {score}.", { run: runTitle(h), score: scoreText(runScore(h)) }), Object.entries(h.dqs_summary ?? {}).map(([m, s]) => `${m}: ${scoreText(s.composite_score ?? s.raw_score ?? null)}`));
      }
      return answer(t("Compare it with an earlier run to see what changed."), [], [{ id: "cmp", label: t("Compare with another run"), onClick: () => sheet.open("compare", { run: id }) }]);
    },
  });

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok, "good"); qc.invalidateQueries({ queryKey: ["next"] }); }
    catch (e) {
      const r = baselineRefusalOf(e);
      const blocked = (e as { response?: { data?: { detail?: { blocked_reason?: string } } } })?.response?.data?.detail?.blocked_reason;
      toast(r?.detail ?? blocked ?? t("That did not work. Nothing was changed."), "bad");
    }
  };
  const close = () => { setDlg(null); setText(""); };

  if (run.isLoading) return <div className="mx-col"><JobHairline /><Skeleton lines={8} label={t("Loading the run")} /></div>;
  if (run.isError || !h) return <ErrorState heading={t("The run could not be loaded")} retryLabel={t("Try again")} onRetry={() => run.refetch()} />;
  const label = h.label || h.id;

  return (
    <div className="mx-col">
      <JobHairline />
      <PageHeader title={runTitle(h)} context={`${sourceLabel(h)}, ${when(h.run_at)}`} stepper={focus ? <Cycle id={id} module={focus} /> : undefined}
        actions={
          <span className="rn-row-actions">
            <Button variant="secondary" onClick={() => sheet.open("compare", { run: id })}>{t("Compare")}</Button>
            {cmp.length > 2 ? <span data-testid="run-compare"><Button variant="secondary" href={href(`/run/${cmp[0]}/vs/${id}?runs=${cmp.join(",")}`)}>{t("Compare with the last {n} runs", { n: cmp.length - 1 })}</Button></span> : null}
            <Button variant="secondary" onClick={() => router.push(href(`${runPath(id)}/agreement`))}>{t("Agreement")}</Button>
            <Button onClick={() => sheet.open("upload", { run: id, module: focus })}>{t("Upload cleaned file")}</Button>
          </span>
        } />
      <dl className="mx-tiles">
        <StatTile label={t("Score")} value={scoreText(runScore(h))} />
        <StatTile label={t("Status")} value={<StatusPill s={h.status} />} />
        <StatTile label={t("Baseline")} value={h.metadata?.baseline ? t("Yes") : t("No")} />
        <StatTile label={t("Objects")} value={String(modules.length)} />
      </dl>
      <Modules list={modules} />
      <Tabs idBase="run-tab" label={t("Run sections")} value={tab} onChange={(v) => setTab(v as Tab)}
        items={[{ id: "overview", label: t("Overview") }, { id: "profile", label: t("Profile") }, { id: "config", label: t("Configuration") }]} />
      <div role="tabpanel" id={`run-tab-panel-${tab}`} aria-labelledby={`run-tab-tab-${tab}`} className="mx-col">
        {tab === "overview" ? (
          <>
            <SplitCapped systemId={systemId} versionId={id} capped={cappedReads(h.metadata)} />
            <Card title={t("What you can do")} sub={t("Actions on this run.")}>
              <div className="mx-links">
                <Button variant="secondary" onClick={() => act(() => analyseRun(id), t("Analysis started"))}>{t("Analyse again")}</Button>
                <Button variant="secondary" onClick={() => act(() => pinBaseline(id, !h.metadata?.baseline), h.metadata?.baseline ? t("Baseline removed") : t("Set as baseline"))}>{h.metadata?.baseline ? t("Remove baseline") : t("Set as baseline")}</Button>
                <Button variant="secondary" onClick={() => act(() => rerunAgents(id), t("Agents started"))}>{t("Run the agents")}</Button>
                <Button variant="secondary" onClick={() => { setText(h.label ?? ""); setDlg("rename"); }}>{t("Rename")}</Button>
                <ExportMenu label={t("Download reconciliation")} formats={[{ id: "xlsx", label: t("Excel workbook") }]} onExport={() => downloadReconciliation(id, { top: 10 })} />
                <Button variant="secondary" onClick={() => sheet.open("extract-target", { run: id })}>{t("Extract target files")}</Button>
                <Button variant="secondary" onClick={() => setDlg("archive")}>{t("Archive older runs")}</Button>
                <Button variant="secondary" onClick={() => setDlg("restore")}>{t("Restore archived runs")}</Button>
                <Button variant="ghost" onClick={() => { setText(""); setDlg("delete"); }}>{t("Delete this run")}</Button>
              </div>
            </Card>
            <Steps id={id} />
            <div className="mx-split">
              {systemId ? <Trend systemId={systemId} /> : null}
              <Predict systemId={systemId} modules={modules} />
            </div>
            <Activity id={id} />
          </>
        ) : tab === "profile" ? <ProfileTab id={id} systemId={systemId} modules={modules} /> : <ConfigTab id={id} />}
      </div>
      <Confirm open={dlg === "rename"} title={t("Rename this run")} confirmLabel={t("Save")} cancelLabel={t("Cancel")} onCancel={close}
        onConfirm={() => { const v = text.trim(); close(); void act(() => renameRun(id, v), t("Run renamed")); }}>
        <Field label={t("Name")}><Input value={text} onChange={(e) => setText(e.target.value)} /></Field>
      </Confirm>
      <Confirm open={dlg === "archive"} title={t("Archive older runs?")} confirmLabel={t("Archive")} cancelLabel={t("Cancel")} onCancel={close}
        onConfirm={() => { close(); void act(() => archiveRuns(10), t("Older runs archived")); }}>{t("The latest 10 runs stay. Every older run is archived. The baseline run is kept.")}</Confirm>
      <Confirm open={dlg === "restore"} title={t("Restore archived runs?")} confirmLabel={t("Restore")} cancelLabel={t("Cancel")} onCancel={close}
        onConfirm={() => { close(); void act(() => restoreRuns(), t("Archived runs restored")); }}>{t("Every archived run comes back into the list.")}</Confirm>
      <Confirm danger open={dlg === "delete"} title={t("Delete this run for good?")} confirmLabel={t("Delete")} cancelLabel={t("Cancel")} onCancel={close}
        onConfirm={() => { const v = text; close(); void act(async () => { await purgeVersion(id, v); router.push(href("/runs")); }, t("Run deleted")); }}>
        <p>{t("Only an archived run can be deleted. Type its name to confirm: {name}", { name: label })}</p>
        <Field label={t("Name")}><Input value={text} onChange={(e) => setText(e.target.value)} /></Field>
      </Confirm>
    </div>
  );
}

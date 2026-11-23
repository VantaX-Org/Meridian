"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { useFixture } from "@/lib/api/v2/fixture";
import {
  acceptReconciliation, deleteMigrationRun, exportDryRunReport, exportLoadFiles, exportMigrationFindings, exportReconciliation,
  extractMigrationTarget, getLoadEvents, getMigrationFindings, startReconciliation, type GapGroup, type LoadEvent, type MigrationFinding,
} from "@/lib/api/v2/migration";
import { useDecideLoad, useLoadApproval, useLoadSimulation } from "@/lib/api/next/load";
import { Button, Card, Confirm, DataTable, EmptyState, FieldChip, Input, PageHeader, Select, SeverityPill, StatTile, Tabs, useAletheiaScope, useToast, type Severity } from "@/ui/kit";
import { gapText, labelText } from "@/lib/v2/labels";
import { AskButton, Gate, humanize, pct, useHref, Verdict, when } from "./common";
import { invalidateLoad, useRecon, useRecords, useRun } from "./hooks";
import { modeLabel } from "./MigrationRuns";
import { displayKey } from "@/lib/v2/work";

const sevLabel = (s: string): string => (s === "critical" ? t("Critical") : s === "high" ? t("High") : s === "medium" ? t("Medium") : s === "low" ? t("Low") : humanize(s));
const Sev = ({ s }: { s: string }) => <SeverityPill sev={s as Severity} label={sevLabel(s)} />;

/** One migration run: gaps, findings, load simulation, reconciliation, records, four-eyes approval and load files. */
export function MigrationRun({ id }: { id: string }) {
  useInterfaceLang();
  const q = useRun(id);
  const href = useHref();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("gaps");
  const [del, setDel] = useState(false);
  const run = q.data?.run;
  const gaps = q.data?.gap_breakdown ?? [];
  const recon = useRecon(id);
  const bad = () => toast(t("The action failed"), "bad");
  const extract = useMutation({ mutationFn: () => extractMigrationTarget(id), onSuccess: () => { toast(t("Target extraction started"), "info"); invalidateLoad(qc); }, onError: bad });
  const remove = useMutation({ mutationFn: () => deleteMigrationRun(id), onSuccess: () => { invalidateLoad(qc); router.push(href("/load/runs")); }, onError: bad });
  const dry = run?.mode === "s4_dry_run";

  useAletheiaScope({
    key: `load/run/${id}`,
    label: t("Asking about run {run}", { run: id }),
    suggestions: [t("What blocks this run most?")],
    answer: () => {
      const g = [...gaps].sort((a, b) => b.records - a.records)[0];
      return g ? { text: t("{n} records are affected by {gap} in {module}.", { n: g.records, gap: humanize(gapText(g.gap_type)), module: g.module }), evidence: [`${g.module} ${humanize(gapText(g.gap_type))} ${g.records}`] } : { text: t("No gaps are recorded for this run."), evidence: [] };
    },
  });

  return (
    <Gate loading={q.isLoading} error={q.isError} retry={() => void q.refetch()} what={t("the run")}>
      <PageHeader
        title={t("Run {run}", { run: id })}
        context={run ? `${modeLabel(run.mode)}, ${run.modules.map(humanize).join(", ")}` : ""}
        actions={<>
          {run?.dest_system_id ? <Button onClick={() => extract.mutate()} disabled={extract.isPending}>{t("Extract the target")}</Button> : null}
          <Button variant="secondary" onClick={() => setDel(true)}>{t("Delete run")}</Button>
          <AskButton />
        </>}
      />
      <div className="mx-col">
      {run ? (
        <dl className="mx-tiles">
          <StatTile label={t("Verdict")} value={<Verdict v={run.readiness_verdict} />} note={labelText(run.status)} />
          <StatTile label={t("Score")} value={pct(run.readiness_score)} bar={run.readiness_score ?? undefined} />
          <StatTile label={t("Records")} value={(run.records_total ?? 0).toLocaleString()} note={`${t("Records blocked")}: ${(run.records_blocked ?? 0).toLocaleString()}`} />
          <StatTile label={t("Critical findings")} value={String(run.critical_count ?? 0)} note={t("{n} structural", { n: q.data?.structural_critical ?? 0 })} />
        </dl>
      ) : null}
      <Card title={t("Detail")}>
        <Tabs idBase="mx-run" label={t("Run detail")} value={tab} onChange={setTab} items={[
          { id: "gaps", label: t("Gaps"), badge: String(gaps.length) },
          { id: "findings", label: t("Findings") },
          { id: "sim", label: t("Load simulation") },
          { id: "recon", label: t("Reconciliation") },
          { id: "records", label: t("Records") },
          { id: "approval", label: t("Approval") },
          { id: "files", label: t("Load files") },
        ]} />
        <div id={`mx-run-panel-${tab}`} role="tabpanel">
          {tab === "gaps" ? <Gaps gaps={gaps} /> : null}
          {tab === "findings" ? <Findings id={id} modules={run?.modules ?? []} /> : null}
          {tab === "sim" ? <Simulation id={id} /> : null}
          {tab === "recon" ? <Recon id={id} q={recon} /> : null}
          {tab === "records" ? <Records id={id} /> : null}
          {tab === "approval" ? <Approval id={id} /> : null}
          {tab === "files" ? <Files id={id} dry={!!dry} /> : null}
        </div>
      </Card>
      </div>
      <Confirm open={del} title={t("Delete run {run}?", { run: id })} confirmLabel={t("Delete run")} cancelLabel={t("Cancel")} danger onConfirm={() => remove.mutate()} onCancel={() => setDel(false)} />
     
    </Gate>
  );
}

function Gaps({ gaps }: { gaps: GapGroup[] }) {
  if (!gaps.length) return <EmptyState heading={t("No gaps found")} />;
  return (
    <DataTable<GapGroup>
      label={t("Gaps")}
      rows={gaps}
      rowKey={(g) => `${g.module}|${g.gap_type}|${g.severity}`}
      columns={[
        { key: "m", label: t("Object"), sort: (g) => g.module, render: (g) => <FieldChip code={g.module} description={humanize(g.module)} /> },
        { key: "g", label: t("Gap"), sort: (g) => g.gap_type, render: (g) => humanize(gapText(g.gap_type)) },
        { key: "s", label: t("Severity"), sort: (g) => g.severity, render: (g) => <Sev s={g.severity} /> },
        { key: "gr", label: t("Basis"), render: (g) => (g.grounded ? t("Measured on the target") : t("Provisional")) },
        { key: "r", label: t("Records"), align: "end", sort: (g) => g.records, render: (g) => g.records.toLocaleString() },
        { key: "f", label: t("Fields"), align: "end", sort: (g) => g.fields, render: (g) => g.fields },
      ]}
    />
  );
}

function Findings({ id, modules }: { id: string; modules: string[] }) {
  const fx = useFixture();
  const toast = useToast();
  const [module, setModule] = useState("");
  const [sev, setSev] = useState("");
  const [search, setSearch] = useState("");
  const f = { module: module || undefined, severity: sev || undefined, search: search || undefined, limit: 200 };
  const q = useQuery({ queryKey: ["ui", "load", fx, "findings", id, f], queryFn: () => getMigrationFindings(id, f) });
  return (
    <>
      <div className="mx-links">
        <Select aria-label={t("Object")} value={module} onChange={(e) => setModule(e.target.value)} options={[{ value: "", label: t("All objects") }, ...modules.map((m) => ({ value: m, label: `${m} ${humanize(m)}` }))]} />
        <Select aria-label={t("Severity")} value={sev} onChange={(e) => setSev(e.target.value)} options={[{ value: "", label: t("All severities") }, ...["critical", "high", "medium", "low"].map((s) => ({ value: s, label: sevLabel(s) }))]} />
        <Input aria-label={t("Search findings")} placeholder={t("Search findings")} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button onClick={() => exportMigrationFindings(id, f).catch(() => toast(t("The export failed"), "bad"))}>{t("Download Excel")}</Button>
      </div>
      <Gate loading={q.isLoading} error={q.isError} retry={() => void q.refetch()} what={t("the findings")}>
        {q.data?.items.length ? (
          <DataTable<MigrationFinding>
            label={t("Findings")}
            rows={q.data.items}
            rowKey={(r) => `${r.module}|${r.record_key}|${r.source_field}|${r.gap_type}|${r.target_field}`}
            columns={[
              { key: "m", label: t("Object"), render: (r) => <FieldChip code={r.module} description={humanize(r.module)} /> },
              { key: "rec", label: t("Record"), render: (r) => <code className="mx-code">{r.record_key ? displayKey(r.record_key) : ""}</code> },
              { key: "sf", label: t("Source field"), render: (r) => (r.source_field ? <FieldChip code={r.source_field} description={r.source_table ?? undefined} /> : "") },
              { key: "sv", label: t("Source value"), render: (r) => r.source_value ?? "" },
              { key: "tf", label: t("Target field"), render: (r) => (r.target_field ? <FieldChip code={r.target_field} description={r.dest_table ?? undefined} /> : "") },
              { key: "g", label: t("Gap"), sort: (r) => r.gap_type, render: (r) => humanize(gapText(r.gap_type)) },
              { key: "s", label: t("Severity"), sort: (r) => r.severity, render: (r) => <Sev s={r.severity} /> },
              { key: "d", label: t("Detail"), render: (r) => r.detail ?? "" },
            ]}
          />
        ) : <EmptyState heading={t("No findings match")} />}
      </Gate>
    </>
  );
}

function Simulation({ id }: { id: string }) {
  const q = useLoadSimulation(id);
  const s = q.data;
  return (
    <Gate loading={q.isLoading} error={q.isError} retry={() => void q.refetch()} what={t("the load simulation")}>
      {s ? (
        <>
          <dl className="mx-tiles">
            <StatTile label={t("Would load")} value={s.totals.would_load.toLocaleString()} note={`${t("Release")}: ${s.release}`} />
            <StatTile label={t("Would fail")} value={s.totals.would_fail.toLocaleString()} note={t("{n} provisional", { n: s.totals.provisional })} />
            <StatTile label={t("Records")} value={s.totals.records.toLocaleString()} note={s.target_connected ? t("Target connected") : t("Target not connected")} />
          </dl>
          <DataTable
            label={t("Load objects")}
            rows={s.objects}
            rowKey={(o) => o.module}
            columns={[
              { key: "m", label: t("Object"), sort: (o) => o.module, render: (o) => <FieldChip code={o.module} description={o.label} /> },
              { key: "t", label: t("Target tables"), render: (o) => o.tables.map((x) => <FieldChip key={x} code={x} />) },
              { key: "r", label: t("Records"), align: "end", sort: (o) => o.records, render: (o) => o.records.toLocaleString() },
              { key: "l", label: t("Would load"), align: "end", sort: (o) => o.would_load, render: (o) => o.would_load.toLocaleString() },
              { key: "f", label: t("Would fail"), align: "end", sort: (o) => o.would_fail, render: (o) => o.would_fail.toLocaleString() },
              { key: "st", label: t("Structural"), align: "end", sort: (o) => o.structural, render: (o) => o.structural },
            ]}
          />
          <DataTable
            label={t("Why records would fail")}
            rows={s.groups}
            rowKey={(g) => `${g.module}|${g.dest_table}|${g.field}|${g.gap_type}`}
            columns={[
              { key: "t", label: t("Table"), render: (g) => <FieldChip code={g.dest_table} /> },
              { key: "f", label: t("Field"), render: (g) => <FieldChip code={g.field} description={g.field_text ?? undefined} /> },
              { key: "m", label: t("Message"), render: (g) => g.message },
              { key: "sv", label: t("Severity"), sort: (g) => g.severity, render: (g) => <Sev s={g.severity} /> },
              { key: "r", label: t("Records"), align: "end", sort: (g) => g.records, render: (g) => g.records.toLocaleString() },
              { key: "ct", label: t("Check table"), render: (g) => (g.check_table ? <FieldChip code={g.check_table} /> : "") },
              { key: "v", label: t("Top values"), render: (g) => g.values.slice(0, 3).map((v) => `${v.value ?? t("Empty")} (${v.records})`).join(", ") },
            ]}
          />
          {s.transports.length ? (
            <DataTable
              label={t("Values missing in the target check tables")}
              rows={s.transports}
              rowKey={(x) => `${x.module}|${x.check_table}|${x.field}`}
              columns={[
                { key: "ct", label: t("Check table"), render: (x) => <FieldChip code={x.check_table} description={x.check_table_text ?? undefined} /> },
                { key: "f", label: t("Field"), render: (x) => <FieldChip code={x.field} description={x.field_text ?? undefined} /> },
                { key: "v", label: t("Missing values"), render: (x) => x.values.map((v) => `${v.value ?? t("Empty")} (${v.records})`).join(", ") },
                { key: "r", label: t("Records"), align: "end", sort: (x) => x.records, render: (x) => x.records.toLocaleString() },
              ]}
            />
          ) : null}
        </>
      ) : <EmptyState heading={t("No simulation for this run")} />}
    </Gate>
  );
}

function Recon({ id, q }: { id: string; q: ReturnType<typeof useRecon> }) {
  const qc = useQueryClient();
  const toast = useToast();
  const bad = () => toast(t("The action failed"), "bad");
  const start = useMutation({ mutationFn: () => startReconciliation(id), onSuccess: () => { toast(t("Reconciliation started"), "info"); invalidateLoad(qc); }, onError: bad });
  const accept = useMutation({ mutationFn: () => acceptReconciliation(id), onSuccess: () => { toast(t("Reconciliation accepted"), "good"); invalidateLoad(qc); }, onError: bad });
  const r = q.data;
  return (
    <>
      <div className="mx-links">
        <Button variant="primary" onClick={() => start.mutate()} disabled={start.isPending}>{t("Reconcile against the target")}</Button>
        {r?.status === "done" ? <Button onClick={() => accept.mutate()} disabled={!!r.accepted_at || accept.isPending}>{r.accepted_at ? t("Accepted") : t("Accept reconciliation")}</Button> : null}
        {r?.status === "done" ? <Button onClick={() => exportReconciliation(id).catch(bad)}>{t("Download Excel")}</Button> : null}
      </div>
      <Gate loading={q.isLoading} error={false} what={t("the reconciliation")}>
        {r && r.status === "done" ? (
          <>
            <dl className="mx-tiles">
              <StatTile label={t("Expected")} value={(r.summary.expected ?? 0).toLocaleString()} note={`${t("Found")}: ${(r.summary.found ?? 0).toLocaleString()}`} />
              <StatTile label={t("Missing")} value={(r.summary.missing ?? 0).toLocaleString()} note={`${t("Unexpected")}: ${(r.summary.unexpected ?? 0).toLocaleString()}`} />
              <StatTile label={t("Real differences")} value={(r.summary.real_differences ?? 0).toLocaleString()} note={`${t("Expected differences")}: ${(r.summary.expected_differences ?? 0).toLocaleString()}`} />
            </dl>
            <DataTable
              label={t("Reconciled tables")}
              rows={r.tables}
              rowKey={(x) => x.table}
              columns={[
                { key: "t", label: t("Table"), render: (x) => <FieldChip code={x.table} description={x.description} /> },
                { key: "e", label: t("Expected"), align: "end", sort: (x) => x.expected, render: (x) => x.expected.toLocaleString() },
                { key: "f", label: t("Found"), align: "end", sort: (x) => x.found, render: (x) => x.found.toLocaleString() },
                { key: "m", label: t("Missing"), align: "end", sort: (x) => x.records_total.missing, render: (x) => x.records_total.missing },
                { key: "d", label: t("Differs"), align: "end", sort: (x) => x.records_total.differing, render: (x) => x.records_total.differing },
                { key: "u", label: t("Unexpected"), align: "end", sort: (x) => x.records_total.unexpected, render: (x) => x.records_total.unexpected },
              ]}
            />
            <DataTable
              label={t("Scores by object")}
              rows={r.scores}
              rowKey={(x) => x.module}
              columns={[
                { key: "m", label: t("Object"), render: (x) => <FieldChip code={x.module} description={humanize(x.module)} /> },
                { key: "s", label: t("Source DQS"), align: "end", sort: (x) => x.source ?? -1, render: (x) => pct(x.source) },
                { key: "p", label: t("Projected target DQS"), align: "end", sort: (x) => x.projected ?? -1, render: (x) => pct(x.projected) },
                { key: "a", label: t("Actual target DQS"), align: "end", sort: (x) => x.actual ?? -1, render: (x) => pct(x.actual) },
                { key: "w", label: t("Why they differ"), render: (x) => x.reasons.slice(0, 3).map((y) => <FieldChip key={y.check_id} code={y.check_id} description={y.description ?? undefined} />) },
              ]}
            />
          </>
        ) : <EmptyState heading={r?.needs_target_extraction ? t("The target has no analysis yet. Extract it first.") : r?.error_detail ?? t("No reconciliation yet")} />}
      </Gate>
    </>
  );
}

function Records({ id }: { id: string }) {
  const [status, setStatus] = useState<"load_fail" | "load_ready">("load_fail");
  const q = useRecords(id, status);
  return (
    <>
      <Select aria-label={t("Record status")} value={status} onChange={(e) => setStatus(e.target.value as "load_fail" | "load_ready")} options={[{ value: "load_fail", label: t("Will not load") }, { value: "load_ready", label: t("Will load") }]} />
      <Gate loading={q.isLoading} error={q.isError} retry={() => void q.refetch()} what={t("the records")}>
        {q.data?.rows.length ? (
          <DataTable
            label={t("Records")}
            rows={q.data.rows}
            rowKey={(r) => `${r.module}|${r.record_key}`}
            columns={[
              { key: "m", label: t("Object"), render: (r) => <FieldChip code={r.module} description={humanize(r.module)} /> },
              { key: "k", label: t("Record"), render: (r) => <code className="mx-code">{displayKey(r.record_key)}</code> },
              { key: "t", label: t("Source table"), render: (r) => (r.source_table ? <FieldChip code={r.source_table} /> : "") },
              { key: "r", label: t("Reasons"), render: (r) => r.reasons.join("; ") },
            ]}
          />
        ) : <EmptyState heading={t("No records in this state")} />}
      </Gate>
    </>
  );
}

function Approval({ id }: { id: string }) {
  const q = useLoadApproval(id);
  const decide = useDecideLoad(id);
  const toast = useToast();
  const [comment, setComment] = useState("");
  const a = q.data;
  const act = (decision: "approved" | "rejected") => decide.mutate({ decision, comment: comment || undefined }, { onSuccess: () => toast(decision === "approved" ? t("Load approved") : t("Load rejected"), "good"), onError: () => toast(t("The decision could not be saved. The preparer cannot decide."), "bad") });
  return (
    <Gate loading={q.isLoading} error={q.isError} retry={() => void q.refetch()} what={t("the approval")}>
      {a ? (
        <>
          <dl className="mx-tiles">
            <StatTile label={t("Prepared by")} value={a.preparer.name || t("Unknown")} note={when(a.first?.at)} />
            <StatTile label={t("Second approval")} value={a.second ? a.second.name : a.rejected ? t("Rejected") : t("Waiting")} note={when(a.second?.at ?? a.rejected?.at)} />
          </dl>
          {a.rejected?.comment ? <p className="mx-muted">{a.rejected.comment}</p> : null}
          {!a.second && !a.rejected ? (
            <div className="mx-links">
              <Input aria-label={t("Comment")} placeholder={t("Comment")} value={comment} onChange={(e) => setComment(e.target.value)} />
              <Button variant="primary" onClick={() => act("approved")} disabled={decide.isPending}>{t("Approve load")}</Button>
              <Button variant="secondary" onClick={() => act("rejected")} disabled={decide.isPending}>{t("Reject load")}</Button>
            </div>
          ) : null}
        </>
      ) : null}
    </Gate>
  );
}

function Files({ id, dry }: { id: string; dry: boolean }) {
  const fx = useFixture();
  const toast = useToast();
  const q = useQuery({ queryKey: ["ui", "load", fx, "events"], queryFn: getLoadEvents });
  const bad = () => toast(t("The export failed"), "bad");
  const rows = (q.data?.items ?? []).filter((e) => e.run_id === id);
  return (
    <>
      <div className="mx-links">
        <Button variant="primary" onClick={() => exportLoadFiles(id, "xlsx").catch(bad)}>{t("Download Excel load file")}</Button>
        <Button onClick={() => exportLoadFiles(id, "csv").catch(bad)}>{t("Download CSV load files")}</Button>
        {dry ? <Button onClick={() => exportDryRunReport(id, "xlsx").catch(bad)}>{t("Download dry-run report (Excel)")}</Button> : null}
        {dry ? <Button onClick={() => exportDryRunReport(id, "pdf").catch(bad)}>{t("Download dry-run report (PDF)")}</Button> : null}
      </div>
      <Gate loading={q.isLoading} error={q.isError} retry={() => void q.refetch()} what={t("the load files")}>
        {rows.length ? (
          <DataTable<LoadEvent>
            label={t("Files handed over")}
            rows={rows}
            rowKey={(e) => e.id}
            columns={[
              { key: "f", label: t("File"), render: (e) => e.filename },
              { key: "fmt", label: t("Format"), render: (e) => humanize(e.export_format) },
              { key: "n", label: t("Records"), align: "end", sort: (e) => e.record_count, render: (e) => e.record_count.toLocaleString() },
              { key: "m", label: t("Objects"), render: (e) => e.modules.map((m) => <FieldChip key={m} code={m} description={humanize(m)} />) },
              { key: "w", label: t("Wave"), render: (e) => e.wave_name ?? "" },
              { key: "by", label: t("Handed over by"), render: (e) => e.exported_by_label ?? "" },
              { key: "at", label: t("Date"), sort: (e) => e.exported_at ?? "", render: (e) => when(e.exported_at) },
            ]}
          />
        ) : <EmptyState heading={t("No load file handed over yet")} />}
      </Gate>
    </>
  );
}

"use client";

/** One finished analysis: gaps by kind, the load simulation, load files, the post-load check, field-level gaps and records. */
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import {
  exportDryRunReport, exportLoadFiles, exportMigrationFindings, getMigrationFindings, getMigrationRecords, getMigrationRun,
  type FindingQuery, type LoadRecord, type MigrationFinding, type MigrationRun,
} from "@/lib/api/v2/migration";
import { draftBlockerFixBatch } from "@/lib/api/v2/reports";
import { getVersionsPage } from "@/lib/api/v2/runs";
import { rowsOf } from "./Start";
import { useLoadSimulation } from "@/lib/api/next/load";
import type { SimGroup, SimTransport } from "@/lib/api/v2/load-simulation";
import { formatDate, formatModuleName } from "@/lib/format";
import { useOpenItem, useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { f1, int } from "@/lib/v2/score";
import { Button, Chip, Code, EmptyState, ErrorState, SegmentedControl, Skeleton, useToast } from "../../kit";
import { HBars, Panel } from "../parts";
import { PostLoadPanel } from "./PostLoad";
import { Field, Labelled, PAGE, Pager, SEVERITIES, Table, analysed, gapText, tone, useMig } from "./shared";

const sevChip = (sev: string) => {
  const k = tone(sev);
  return <Chip tone={k === "data" ? "neutral" : k}>{sev}</Chip>;
};

export function RunDetail({ run }: { run: MigrationRun }) {
  const q = useMig(["run", run.id], () => getMigrationRun(run.id));
  const src = run.source_system_id;
  const versions = useMig(["versions", src], () => getVersionsPage({ system_id: src ?? undefined, limit: PAGE }), !!src && !!run.source_version_id);
  const srcRun = versions.data?.versions.find((v) => v.id === run.source_version_id) ?? null;
  const date = formatDate(run.created_at, "date");
  const groups = q.data?.gap_breakdown ?? [];
  const gapTypes = [...new Set(groups.map((g) => g.gap_type))];
  const fixGroups = [...new Map(groups.map((g) => [`${g.module}:${g.gap_type}`, { module: g.module, gap_type: g.gap_type }])).values()];
  return (
    <>
      <Panel
        title={t("Gaps by kind")}
        meta={srcRun ? t("Analysis of {date}, from the source run of {run}, {n} rows", { date, run: formatDate(srcRun.run_at, "datetime"), n: int(rowsOf(srcRun)) }) : t("Analysis of {date}", { date })}
        testId="mig-gaps"
      >
        {q.isPending ? <Skeleton /> : q.isError ? <ErrorState sentence={t("This analysis could not be read.")} onRetry={() => void q.refetch()} /> : groups.length === 0 ? <EmptyState heading={t("The analysis found no gaps.")} /> : (
          <>
            {q.data.structural_critical > 0 ? <p className="nx-ld-lede">{t("{n} critical gaps are in the structure (fields and keys), not in the records.", { n: int(q.data.structural_critical) })}</p> : null}
            <HBars
              label={t("Gaps by kind")}
              testId="mig-gap-bars"
              rows={groups.map((g) => ({
                key: `${g.module}:${g.gap_type}:${g.severity}`,
                label: `${gapText(g.gap_type)}, ${formatModuleName(g.module)}`,
                value: g.n,
                text: g.records ? t("{n} gaps, {r} records", { n: int(g.n), r: int(g.records) }) : t("{n} gaps", { n: int(g.n) }),
                tone: tone(g.severity),
              }))}
            />
          </>
        )}
      </Panel>
      {analysed(run) ? <LoadSim runId={run.id} /> : null}
      <LoadFilesPanel run={run} />
      {analysed(run) ? <div id="mig-post-load"><PostLoadPanel run={run} /></div> : null}
      <FindingsPanel run={run} gapTypes={gapTypes} groups={fixGroups} />
      <RecordsPanel run={run} />
    </>
  );
}

function LoadSim({ runId }: { runId: string }) {
  const q = useLoadSimulation(runId);
  if (q.isPending) return <Panel title={t("Load simulation")} testId="load-sim"><Skeleton /></Panel>;
  if (q.isError) return <Panel title={t("Load simulation")} testId="load-sim"><ErrorState sentence={t("The load simulation could not be read.")} onRetry={() => void q.refetch()} /></Panel>;
  const s = q.data;
  return (
    <Panel title={t("Load simulation")} meta={t("{ok} of {n} records would load", { ok: int(s.totals.would_load), n: int(s.totals.records) })} testId="load-sim">
      {s.groups.length === 0 ? <EmptyState heading={t("No record would fail the load.")} /> : (
      <>
      <HBars
        label={t("Would load and would fail per load object")}
        testId="load-sim-bars"
        rows={s.objects.flatMap((o) => [
          { key: `${o.module}:ok`, label: t("{object}, would load", { object: o.label || formatModuleName(o.module) }), value: o.would_load, text: int(o.would_load), tone: "good" as const },
          { key: `${o.module}:fail`, label: t("{object}, would fail", { object: o.label || formatModuleName(o.module) }), value: o.would_fail, text: o.provisional ? t("{n} ({p} provisional)", { n: int(o.would_fail), p: int(o.provisional) }) : int(o.would_fail), tone: "bad" as const },
        ])}
      />
      {s.totals.provisional > 0 ? <p className="nx-ld-meta" data-testid="load-sim-provisional">{t("{n, plural, one {# record fails} other {# records fail}} only on values missing from the SAP standard baseline. The target may already hold them; connect the target to confirm.", { n: s.totals.provisional })}</p> : null}
        <Table<SimGroup>
          testId="load-sim-groups"
          caption={t("Messages")}
          rows={s.groups}
          rowKey={(g) => `${g.module}:${g.dest_table}:${g.field}:${g.gap_type}:${g.rule}`}
          rowLabel={(g) => g.message}
          columns={[
            { id: "msg", label: t("Message"), cell: (g) => <>{g.message}{g.provisional ? <div className="nx-ld-meta">{t("Provisional")}</div> : null}</> },
            { id: "field", label: t("Field"), cell: (g) => <Code code={g.dest_table ? `${g.dest_table}-${g.field}` : g.field} text={g.field_text ?? undefined} /> },
            { id: "sev", label: t("Severity"), cell: (g) => sevChip(g.severity) },
            { id: "rec", label: t("Records"), cell: (g) => (g.structural ? t("Structure") : int(g.records)) },
            { id: "sample", label: t("Sample records"), cell: (g) => (g.samples.length ? g.samples.join(", ") : null) },
          ]}
        />
      </>
      )}
      {s.transports.length > 0 ? (
        <Table<SimTransport>
          testId="load-sim-transports"
          caption={t("Configuration to transport")}
          rows={s.transports}
          rowKey={(r) => `${r.module}:${r.check_table}:${r.field}`}
          rowLabel={(r) => r.check_table}
          columns={[
            { id: "ct", label: t("Check table"), cell: (r) => <>{<Code code={r.check_table} text={r.check_table_text ?? undefined} />}{r.provisional ? <div className="nx-ld-meta">{t("Provisional")}</div> : null}</> },
            { id: "field", label: t("Field"), cell: (r) => <Code code={r.field} text={r.field_text ?? undefined} /> },
            { id: "vals", label: t("Missing values"), cell: (r) => r.values.map((v) => t("{value} ({n} records)", { value: v.value || t("(initial)"), n: int(v.records) })).join(", ") },
            { id: "rec", label: t("Records"), cell: (r) => int(r.records) },
          ]}
        />
      ) : null}
      <p className="nx-ld-meta">
        {s.target_connected ? t("Checked against the target's own configuration and the {release} dictionary.", { release: s.release }) : t("No target is connected: checked against the SAP standard baseline and the {release} dictionary.", { release: s.release })}{" "}
        <Link href="/load/plan">{t("See the load order")}</Link>
      </p>
    </Panel>
  );
}

export function LoadFilesPanel({ run }: { run: MigrationRun }) {
  const { can, shared, viewAs } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const exp = useMutation({
    mutationFn: (fmt: "csv" | "xlsx") => exportLoadFiles(run.id, fmt),
    onSuccess: (name) => { toast({ text: t("Load files saved as {name}", { name }), tone: "good" }); void qc.invalidateQueries({ queryKey: ["migration"] }); },
    onError: (e) => toast({ text: errorSentence(e, t("The load files could not be prepared.")), tone: "bad" }),
  });
  const report = useMutation({
    mutationFn: (fmt: "xlsx" | "pdf") => exportDryRunReport(run.id, fmt),
    onSuccess: (name) => toast({ text: t("Report saved as {name}", { name }), tone: "good" }),
    onError: (e) => toast({ text: errorSentence(e, t("The dry-run report could not be prepared.")), tone: "bad" }),
  });
  if (!can("export") || shared || viewAs) return null;
  return (
    <>
      {run.mode === "s4_dry_run" && run.status === "analysed" ? (
        <Panel title={t("Dry-run report")} meta={t("Summary, rules hit and the records that fail to load")} testId="mig-dry-run-report">
          <div className="nx-ld-actions">
            <Button variant="secondary" disabled={report.isPending} onClick={() => report.mutate("xlsx")}>{t("Download as Excel")}</Button>
            <Button variant="secondary" disabled={report.isPending} onClick={() => report.mutate("pdf")}>{t("Download as PDF")}</Button>
          </div>
        </Panel>
      ) : null}
      <Panel title={t("Load files")} meta={t("Records without blocking gaps, shaped for the target system")} testId="mig-load-files">
        <div className="nx-ld-actions">
          <Button variant="secondary" disabled={exp.isPending} onClick={() => exp.mutate("csv")}>{t("Download as CSV files")}</Button>
          <Button variant="secondary" disabled={exp.isPending} onClick={() => exp.mutate("xlsx")}>{t("Download as Excel")}</Button>
        </div>
      </Panel>
    </>
  );
}

function FindingsPanel({ run, gapTypes, groups }: { run: MigrationRun; gapTypes: string[]; groups: { module: string; gap_type: string }[] }) {
  const { can, shared, viewAs } = useV2Session();
  const toast = useToast();
  const { hrefFor } = useOpenItem();
  const [module, setModule] = useUrlParam<string>("gap_module", "");
  const [gap, setGap] = useState("");
  const [sev, setSev] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const filt: FindingQuery = { module: module || undefined, gap_type: gap || undefined, severity: sev || undefined, search: search || undefined };
  const q = useMig(["findings", run.id, filt, offset], () => getMigrationFindings(run.id, { ...filt, limit: PAGE, offset }));
  const [batch, setBatch] = useState<string | null>(null);
  const canFix = !!run.wave_id && can("apply") && !shared && !viewAs;
  const draft = useMutation({
    mutationFn: (g: { module: string; gap_type: string }) => draftBlockerFixBatch(run.wave_id as string, g),
    onSuccess: (b) => { setBatch(b.id); toast({ text: t("Fix batch drafted with {n} items", { n: int(b.items) }), tone: "good" }); },
    onError: (e) => toast({ text: errorSentence(e, t("The fix batch could not be drafted.")), tone: "bad" }),
  });
  const exp = useMutation({
    mutationFn: () => exportMigrationFindings(run.id, filt),
    onError: (e) => toast({ text: errorSentence(e, t("The gaps could not be exported.")), tone: "bad" }),
  });
  const move = (fn: () => void) => { fn(); setOffset(0); };
  return (
    <Panel title={t("Field-level gaps")} meta={q.data ? t("{n} gaps", { n: int(q.data.total) }) : undefined} testId="mig-findings">
      <form className="nx-ld-filters" onSubmit={(e) => e.preventDefault()}>
        <Labelled label={t("Object")}>
          <select className="nx-input" value={module} onChange={(e) => move(() => setModule(e.target.value))}>
            <option value="">{t("All")}</option>
            {run.modules.map((m) => <option key={m} value={m}>{formatModuleName(m)}</option>)}
          </select>
        </Labelled>
        <Labelled label={t("Kind of gap")}>
          <select className="nx-input" value={gap} onChange={(e) => move(() => setGap(e.target.value))}>
            <option value="">{t("All")}</option>
            {gapTypes.map((k) => <option key={k} value={k}>{gapText(k)}</option>)}
          </select>
        </Labelled>
        <Labelled label={t("Severity")}>
          <select className="nx-input" value={sev} onChange={(e) => move(() => setSev(e.target.value))}>
            <option value="">{t("All")}</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Labelled>
        <Labelled label={t("Search")}>
          <input className="nx-input" type="search" value={search} onChange={(e) => move(() => setSearch(e.target.value))} />
        </Labelled>
        {can("export") ? <Button variant="secondary" loading={exp.isPending} onClick={() => exp.mutate()}>{t("Export to Excel")}</Button> : null}
      </form>
      {canFix && groups.length > 0 ? (
        <div className="nx-ld-actions" data-testid="mig-fix-groups">
          {groups.map((g) => {
            const label = `${gapText(g.gap_type)}, ${formatModuleName(g.module)}`;
            return <Button key={`${g.module}:${g.gap_type}`} variant="secondary" size={32} disabled={draft.isPending} onClick={() => draft.mutate({ module: g.module, gap_type: g.gap_type })}>{t("Draft a fix batch for {r}", { r: label })}</Button>;
          })}
          {batch ? <Link href={hrefFor({ kind: "batch", id: batch })}>{t("Open the fix batch")}</Link> : null}
        </div>
      ) : null}
      {q.isPending ? <Skeleton /> : q.isError ? <ErrorState sentence={t("This list could not be read.")} onRetry={() => void q.refetch()} /> : q.data.items.length === 0 ? <EmptyState heading={t("No gap matches these filters.")} /> : (
        <>
          <Table<MigrationFinding>
            caption={t("Field-level gaps")}
            rows={q.data.items}
            rowKey={(f) => `${f.module}:${f.record_key}:${f.source_field}:${f.gap_type}:${f.target_field}`}
            rowLabel={(f) => f.record_key ?? f.module}
            columns={[
              { id: "rec", label: t("Record"), cell: (f) => (f.record_key ? <Code code={f.record_key} text={formatModuleName(f.module)} /> : formatModuleName(f.module)) },
              { id: "gap", label: t("Gap"), cell: (f) => gapText(f.gap_type) },
              { id: "sev", label: t("Severity"), cell: (f) => sevChip(f.severity) },
              { id: "sf", label: t("Source field"), cell: (f) => <Field name={f.source_field} /> },
              { id: "sv", label: t("Source value"), cell: (f) => f.source_value ?? f1(null) },
              { id: "tf", label: t("Target field"), cell: (f) => <Field name={f.target_field} /> },
              { id: "tv", label: t("Target value"), cell: (f) => f.target_value ?? f1(null) },
              { id: "why", label: t("Why"), cell: (f) => f.detail ?? f1(null) },
            ]}
          />
          <Pager offset={offset} total={q.data.total} onMove={setOffset} />
        </>
      )}
    </Panel>
  );
}

function RecordsPanel({ run }: { run: MigrationRun }) {
  const [which, setWhich] = useState<LoadRecord["status"]>("load_fail");
  const [offset, setOffset] = useState(0);
  const q = useMig(["records", run.id, which, offset], () => getMigrationRecords(run.id, which, offset));
  return (
    <Panel title={t("Records")} meta={q.data ? t("{n} records", { n: int(q.data.total) }) : undefined} testId="mig-records">
      <SegmentedControl<LoadRecord["status"]>
        label={t("Records")}
        value={which}
        onChange={(v) => { setWhich(v); setOffset(0); }}
        items={[{ value: "load_fail", label: t("Would not load") }, { value: "load_ready", label: t("Ready to load") }]}
      />
      {q.isPending ? <Skeleton /> : q.isError ? <ErrorState sentence={t("This list could not be read.")} onRetry={() => void q.refetch()} /> : q.data.rows.length === 0 ? <EmptyState heading={t("No records in this list.")} /> : (
        <>
          <Table<LoadRecord>
            caption={which === "load_fail" ? t("Records that would not load") : t("Records ready to load")}
            rows={q.data.rows}
            rowKey={(r) => `${r.module}:${r.source_table}:${r.record_key}`}
            rowLabel={(r) => r.record_key}
            columns={[
              { id: "rec", label: t("Record"), cell: (r) => <Code code={r.record_key} /> },
              { id: "obj", label: t("Object"), cell: (r) => formatModuleName(r.module) },
              { id: "tab", label: t("Table"), cell: (r) => r.source_table ?? f1(null) },
              { id: "why", label: t("Reasons"), cell: (r) => (r.reasons.length === 0 ? f1(null) : r.reasons.join("; ")) },
            ]}
          />
          <Pager offset={offset} total={q.data.total} onMove={setOffset} />
        </>
      )}
    </Panel>
  );
}

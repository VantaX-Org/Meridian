"use client";
import { Disclose, Guide, Steps } from "./Guide";
import { PairedQuality } from "./PairedQuality";
import "../runs.css";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import {
  checkTargetWorkbook, deleteFieldMapping, deleteMigrationRun, deleteValueEntry, decideValueEntry, exportLoadFiles, exportTargetWorkbook, extractMigrationTarget, exportMigrationFindings, exportReconciliation, getFieldMap, getMigrationFindings,
  getMigrationRecords, getMigrationRun, getMigrationRuns, getReconciliation, getReconciliationRecords, getValueCandidates, getValueMap,
  saveValueMap, seedFieldMap, startMigration, startReconciliation, updateFieldMapping, type FieldDef, type MigrationMode, type WorkbookFormat, type MigrationRun,
  type ReconKind,
} from "@/lib/api/v2/migration";
import { extractObjects, getVersionsPage } from "@/lib/api/v2/runs";
import { formatDate, formatModuleName } from "@/lib/format";
import { useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { fieldDelta, needsTransform, type Delta, type DeltaKind } from "@/lib/v2/field-delta";
import { labelText, moduleText } from "@/lib/v2/labels";
import { useLandscape } from "@/lib/v2/queries";
import { f1, int } from "@/lib/v2/score";
import { Confirm } from "../admin/kit";
import { Sev } from "../inspector/rule";
import { Coded, EmptyFrame, ErrorFrame, PageTitle, Skeleton } from "../parts";
import { useToast } from "../Toast";
import { CcBanner, CcHBars, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";

/**
 * Migration analysis: how ready the source data is to load into the target system (api/routes/migration.py). Every
 * figure is read from the backend; a figure it has not computed shows as a dash.
 */

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; };
const PAGE = 50;

const VERDICT = { go: "go", conditional: "at-risk", "no-go": "no-go" } as const;
const VERDICT_TEXT: Record<string, () => string> = {
  go: () => t("Ready to load"),
  conditional: () => t("Ready with conditions"),
  "no-go": () => t("Not ready to load"),
};
// migration_runs.status: queued|running|analysed|exported|failed (db/schema.py). An exported run was analysed first.
const analysed = (r: { status: string }) => r.status === "analysed" || r.status === "exported";
const STATUS_TEXT: Record<string, () => string> = {
  queued: () => t("Queued"),
  running: () => t("Running"),
  analysed: () => t("Analysed"),
  exported: () => t("Exported"),
  failed: () => t("Failed"),
};
const MODE: Record<MigrationMode, () => string> = {
  source_to_destination: () => t("Source to target system"),
  source_to_source: () => t("Source to source"),
  s4_dry_run: () => t("S/4HANA dry run"),
};
const GAP: Record<string, () => string> = {
  unmapped_field: () => t("Field with no mapping"),
  obsolete_target: () => t("Target field no longer exists"),
  target_field_missing: () => t("Target field missing"),
  value_unmapped: () => t("Value with no target value"),
  target_mandatory: () => t("Mandatory target field empty"),
  key_missing: () => t("Key missing"),
  key_collision: () => t("Two records get the same key"),
  target_key_exists: () => t("Key already in the target"),
  length_truncation: () => t("Value longer than the target field"),
  type_conversion: () => t("Type does not convert"),
  precision_loss: () => t("Decimals lost"),
  case_change: () => t("Case changes"),
  domain_value: () => t("Value outside the field's domain"),
  check_table_value: () => t("Value not in the check table"),
  target_config_unverified: () => t("Target configuration not verified"),
};
export const gapText = (g: string) => GAP[g]?.() ?? (g.startsWith("field_status_") ? t("Field status in the target: {kind}", { kind: g.slice(13) }) : g);
const tone = (sev: string) => (sev === "critical" ? "crit" : sev === "high" || sev === "medium" ? "warn" : "data");
const SEVERITIES = ["critical", "high", "medium", "low"];

function useMig<T>(key: unknown[], fn: () => Promise<T>, enabled = true) {
  const fixture = useFixture();
  return useQuery({ queryKey: ["migration", ...key, fixture], queryFn: fn, staleTime: 60_000, retry, enabled });
}

function Table({ title, head, children }: { title: string; head: string[]; children: ReactNode }) {
  return (
    <ScrollFrame label={title}>
      <table className="m2-tbl m2-cards">
        <caption className="m2-sr">{title}</caption>
        <thead><tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </ScrollFrame>
  );
}

const DELTA: Record<DeltaKind, (d: Delta) => string> = {
  dropped: () => t("Not carried to the target"),
  unknown: () => t("Definition not in the dictionary"),
  type: (d) => t("Type changes from {a} to {b}", { a: String(d.from), b: String(d.to) }),
  shorter: (d) => t("Shortened from {a} to {b} characters", { a: int(Number(d.from)), b: int(Number(d.to)) }),
  longer: (d) => t("Lengthened from {a} to {b} characters", { a: int(Number(d.from)), b: int(Number(d.to)) }),
  decimals: (d) => t("Decimals change from {a} to {b}", { a: int(Number(d.from)), b: int(Number(d.to)) }),
  check_table: (d) => t("Checked against {b} instead of {a}", { a: d.from ? String(d.from) : t("no table"), b: d.to ? String(d.to) : t("no table") }),
  same: () => t("Same definition"),
};
const ORIGIN: Record<string, () => string> = {
  identity: () => t("Same field name"),
  sap_standard: () => t("SAP standard conversion"),
  steward: () => t("Set by a steward"),
};
const defText = (d: FieldDef | null) => d?.type ? [d.type, int(d.length), d.decimals ? t("{n} decimals", { n: int(d.decimals) }) : null, d.check_table].filter(Boolean).join(" ") : f1(null);

/** TABLE.FIELD with its dictionary description beside it. */
function Field({ name, def }: { name: string | null; def?: FieldDef | null }) {
  if (!name) return <>{f1(null)}</>;
  return <Coded code={name} text={def?.description ?? undefined} first />;
}

export function Migration() {
  const runs = useMig(["runs"], getMigrationRuns);
  const busy = runs.data?.runs.some((r) => r.status === "queued" || r.status === "running") ?? false;
  const { refetch } = runs;
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => void refetch(), 10_000);
    return () => clearInterval(id);
  }, [busy, refetch]);
  const [picked, setPicked] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [removing, setRemoving] = useState<MigrationRun | null>(null);
  const { can, shared, viewAs } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => deleteMigrationRun(id),
    onSuccess: () => { toast.show(t("Analysis deleted")); setRemoving(null); setPicked(null); void qc.invalidateQueries({ queryKey: ["migration"] }); },
    onError: (e) => { setRemoving(null); toast.show(errorSentence(e, t("The analysis could not be deleted.")), "error"); },
  });

  if (runs.isPending) return <CcPage title={t("Migration")}><Skeleton width="100%" height={320} /></CcPage>;
  if (runs.isError) {
    return (
      <CcPage title={t("Migration")}>
        {status(runs.error) === 403 ? <EmptyFrame>{t("Your role cannot read the migration analyses.")}</EmptyFrame> : (
          <ErrorFrame onRetry={() => void runs.refetch()}>{t("The migration analyses could not be read.")}</ErrorFrame>
        )}
      </CcPage>
    );
  }
  const list = runs.data.runs;
  const latest = list.find((r) => analysed(r)) ?? null;
  const current = list.find((r) => r.id === picked) ?? latest;
  const startBtn = can("analyse") ? (
    <button type="button" className="m2-btn m2-next" aria-expanded={starting} onClick={() => setStarting((s) => !s)}>{t("Start an analysis")}</button>
  ) : undefined;
  return (
    <CcPage><PageTitle>{t("Migration")}</PageTitle>
      <Guide
        steps={{ labels: [t("Start an analysis"), t("Fix what would not load"), t("Load into the target"), t("Check the result")], current: !latest ? 0 : (latest.records_blocked ?? 0) > 0 ? 1 : 2 }}
        shows={t("Each analysis checks whether your records would load into the target system, and compares the quality of every object before and after.")}
        means={[
          [t("Readiness"), t("A score from 0 to 100 for how ready the records are to load.")],
          [t("Records that would not load"), t("Records the target system would reject, so they need fixing first.")],
          [t("Source, projected and actual"), t("Quality in the old system, the score the load should reach, and the score measured in the target after loading.")],
        ]}
      />
      {latest ? (
        <CcBanner
          eyebrow={t("Migration analysis of {date}", { date: formatDate(latest.completed_at ?? latest.created_at, "date") })}
          verdict={latest.readiness_verdict ? VERDICT[latest.readiness_verdict] : undefined}
          headline={latest.readiness_verdict ? VERDICT_TEXT[latest.readiness_verdict]() : t("No verdict")}
          why={t("{blocked} of {total} records would not load, with {n} critical gaps.", { blocked: int(latest.records_blocked), total: int(latest.records_total), n: int(latest.critical_count) })}
          figs={[
            { label: t("Readiness"), value: f1(latest.readiness_score) },
            { label: t("Records that would not load"), value: int(latest.records_blocked) },
            { label: t("Objects"), value: int(latest.modules.length), note: MODE[latest.mode]?.() },
          ]}
          action={startBtn}
          testId="mig-banner"
          label={t("Migration analysis")}
        />
      ) : (
        <CcBanner eyebrow={t("Migration analysis")} headline={t("No analysis has finished yet")} why={t("Start one to see which records would not load into the target system.")} action={startBtn} testId="mig-banner" label={t("Migration analysis")} />
      )}
      {starting ? <p className="m2-meta">{t("Starting an analysis only checks your records. The page updates by itself while it runs.")}</p> : null}
      {starting ? <StartForm onDone={() => setStarting(false)} /> : null}
      {removing ? (
        <Confirm
          title={t("Delete the analysis of {d}", { d: formatDate(removing.created_at, "datetime") })}
          body={t("The analysis, its gaps, load files and reconciliations are removed, with the stored copies of the records. This cannot be undone.")}
          confirm={t("Delete the analysis")}
          danger
          pending={remove.isPending}
          onCancel={() => setRemoving(null)}
          onConfirm={() => remove.mutate(removing.id)}
        />
      ) : null}
      <TargetWorkbookPanel />
      <Disclose title={t("Quality in the source and in the target")} hint={t("Source quality, projected and actual target quality, and why they differ.")}><PairedQuality /></Disclose>
      <Disclose title={t("All analyses")} hint={t("{n} analyses, newest first", { n: int(list.length) })} open={!latest}>
      <Panel title={t("Analyses")} meta={t("{n} analyses, newest first", { n: int(list.length) })} testId="mig-runs">
        {list.length === 0 ? <EmptyFrame>{t("No analysis has been started.")}</EmptyFrame> : (
          <Table title={t("Analyses")} head={[t("Started"), t("Objects"), t("Status")]}>
            {list.map((r) => (
              <tr key={r.id} aria-current={r.id === current?.id ? "true" : undefined}>
                <th scope="row" className="m2-card-lead">{analysed(r) ? (
                  <button type="button" className="m2-rowlink" aria-pressed={r.id === current?.id} aria-label={t("Open the analysis of {d}", { d: formatDate(r.created_at, "datetime") })} onClick={() => setPicked(r.id)}>{formatDate(r.created_at, "datetime")}</button>
                ) : formatDate(r.created_at, "datetime")}<div className="m2-meta">{MODE[r.mode]?.() ?? r.mode}</div></th>
                <td data-label={t("Objects")}>{r.modules.map(formatModuleName).join(", ")}</td>
                <td data-label={t("Status")}>{analysed(r) && r.readiness_verdict ? VERDICT_TEXT[r.readiness_verdict]() : STATUS_TEXT[r.status]?.() ?? r.status}{r.status === "failed" && r.error_detail ? <div className="m2-meta">{r.error_detail}</div> : null}
                  {analysed(r) ? <div className="m2-meta">{t("Readiness {s}, {n} would not load", { s: f1(r.readiness_score), n: int(r.records_blocked) })}</div> : null}
                  {can("analyse") && !shared && !viewAs && r.status !== "queued" && r.status !== "running" ? (
                    <div><button type="button" className="m2-btn m2-sm" aria-label={t("Delete the analysis of {d}", { d: formatDate(r.created_at, "datetime") })} onClick={() => setRemoving(r)}>{t("Delete")}</button></div>
                  ) : null}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
      </Disclose>
      {current && analysed(current) ? <RunDetail run={current} /> : null}
      <FieldMapPanel modules={current?.modules ?? []} />
    </CcPage>
  );
}

function StartForm({ onDone }: { onDone: () => void }) {
  const land = useLandscape(null);
  const toast = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<MigrationMode>("s4_dry_run");
  const [src, setSrc] = useState("");
  const [dest, setDest] = useState("");
  const [mods, setMods] = useState<string[]>([]);
  const start = useMutation({
    mutationFn: startMigration,
    onSuccess: () => {
      toast.show(t("The analysis is queued. It appears in the list when it starts."));
      void qc.invalidateQueries({ queryKey: ["migration"] });
      onDone();
    },
    onError: (e) => toast.show(errorSentence(e, t("The analysis could not be started.")), "error"),
  });
  const systems = land.data?.systems ?? [];
  const objects = land.data?.objects ?? [];
  const needsDest = mode !== "s4_dry_run";
  const ok = src !== "" && mods.length > 0 && (!needsDest || dest !== "");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ok) start.mutate({ mode, source_system_id: src, dest_system_id: needsDest ? dest : undefined, target_release: "s4hana", modules: mods });
  };
  return (
    <Panel title={t("Start an analysis")} testId="mig-start">
      <form className="m2-rfilters" onSubmit={submit}>
        <label>{t("Kind")}
          <select className="m2-sel" value={mode} onChange={(e) => setMode(e.target.value as MigrationMode)}>
            {(Object.keys(MODE) as MigrationMode[]).map((m) => <option key={m} value={m}>{MODE[m]()}</option>)}
          </select>
        </label>
        <label>{t("Source system")}
          <select className="m2-sel" value={src} onChange={(e) => setSrc(e.target.value)}>
            <option value="">{t("Choose a system")}</option>
            {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {needsDest ? (
          <label>{t("Target system")}
            <select className="m2-sel" value={dest} onChange={(e) => setDest(e.target.value)}>
              <option value="">{t("Choose a system")}</option>
              {systems.filter((s) => s.id !== src).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        ) : null}
        <fieldset>
          <legend>{t("Objects")}</legend>
          {objects.map((o) => (
            <label key={o.module}>
              <input type="checkbox" checked={mods.includes(o.module)} onChange={(e) => setMods((m) => (e.target.checked ? [...m, o.module] : m.filter((x) => x !== o.module)))} /> {o.label}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="m2-btn m2-next" disabled={!ok || start.isPending}>{t("Start")}</button>
      </form>
    </Panel>
  );
}

function RunDetail({ run }: { run: MigrationRun }) {
  const q = useMig(["run", run.id], () => getMigrationRun(run.id));
  const title = t("Gaps by kind");
  return (
    <>
      <Panel title={title} meta={t("Analysis of {date}", { date: formatDate(run.created_at, "date") })} testId="mig-gaps">
        {q.isPending ? <Skeleton width="100%" height={120} /> : q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("This analysis could not be read.")}</ErrorFrame> : q.data.gap_breakdown.length === 0 ? (
          <EmptyFrame>{t("The analysis found no gaps.")}</EmptyFrame>
        ) : (
          <>
            {q.data.structural_critical > 0 ? <p className="m2-meta">{t("{n} critical gaps are in the structure (fields and keys), not in the records.", { n: int(q.data.structural_critical) })}</p> : null}
            <CcHBars
              label={title}
              testId="mig-gap-bars"
              rows={q.data.gap_breakdown.map((g) => ({
                key: `${g.module}-${g.gap_type}-${g.severity}`,
                label: `${gapText(g.gap_type)}, ${formatModuleName(g.module)}`,
                value: g.n,
                text: g.records ? t("{n} gaps, {r} records", { n: int(g.n), r: int(g.records) }) : t("{n} gaps", { n: int(g.n) }),
                tone: tone(g.severity),
              }))}
            />
          </>
        )}
      </Panel>
      <LoadFilesPanel run={run} />
      {analysed(run) ? <PostLoadPanel run={run} /> : null}
      <FindingsPanel run={run} gapTypes={[...new Set((q.data?.gap_breakdown ?? []).map((g) => g.gap_type))]} />
      <RecordsPanel run={run} />
    </>
  );
}

/** Target load files for the records without blocking gaps (migration.py /export/{run}/{fmt}). */
const HOLD: Record<string, () => string> = {
  mandatory: () => t("Required value is empty"),
  too_long: () => t("Longer than the workbook allows"),
  bad_date: () => t("Not a valid date"),
  bad_boolean: () => t("Not a yes or no value"),
  not_in_picklist: () => t("Not in the workbook's list of values"),
  bad_whole_number: () => t("Not a whole number"),
  bad_number: () => t("Not a number"),
  bad_id: () => t("Identifier has spaces at the ends or a control character"),
  bad_text: () => t("Holds a control character"),
  mandatory_for_country: () => t("Required for this country and empty"),
  value_map: () => t("No confirmed value mapping"),
};
const holdText = (reason: string) => HOLD[reason]?.() ?? reason;
const WORKBOOK_FORMAT: Record<string, () => string> = {
  xlsx: () => t("Excel workbook"),
  xls: () => t("Excel 97-2003 workbook"),
  xlsb: () => t("Excel binary workbook"),
  ods: () => t("OpenDocument spreadsheet"),
  xml2003: () => t("XML Spreadsheet 2003, the Migration Cockpit template"),
  delimited: () => t("Delimited text file"),
  archive: () => t("ZIP of load files"),
};
const WORKBOOK_TYPES = ".xlsx,.xlsm,.xltx,.xltm,.xls,.xlsb,.ods,.xml,.csv,.tsv,.txt,.dat,.zip";

/**
 * The new system's workbook or load file is the input, and a finished run fills it in that file's own columns
 * (migration.py /target-workbook). The check comes first, so the user sees what fits before anything is exported.
 */
function TargetWorkbookPanel() {
  const { can, shared, viewAs } = useV2Session();
  const toast = useToast();
  const systems = useLandscape(null).data?.systems ?? [];
  const allowed = can("export") && !shared && !viewAs && systems.length > 0;
  const versions = useMig(["target-workbook-runs", systems.map((s) => s.id)], async () => {
    const pages = await Promise.all(systems.map(async (s) => ({ s, page: await getVersionsPage({ system_id: s.id, limit: 50 }) })));
    return pages
      .flatMap(({ s, page }) => page.versions.filter((v) => v.status.includes("complete")).map((v) => ({ v, system: s.name })))
      .sort((a, b) => b.v.run_at.localeCompare(a.v.run_at));
  }, allowed);
  const [picked, setPicked] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const run = picked || versions.data?.[0]?.v.id || "";
  const check = useMutation({ mutationFn: (a: { run: string; file: File }) => checkTargetWorkbook(a.run, a.file) });
  const exp = useMutation({
    mutationFn: (fmt: WorkbookFormat) => exportTargetWorkbook(run, file as File, fmt, check.data?.format.written_as),
    onSuccess: (name) => toast.show(t("Workbook data saved as {name}", { name })),
    onError: (e) => toast.show(errorSentence(e, t("The workbook data could not be prepared.")), "error"),
  });
  const update = useMutation({
    mutationFn: (l: { system_id: string; modules: string[] }) => extractObjects(l.system_id, l.modules, true),
    onError: (e) => toast.show(errorSentence(e, t("The run could not be started.")), "error"),
  });
  if (!allowed) return null;
  const title = t("Workbook from the new system");
  const meta = t("Fill the new system's workbook or load file from a finished run");
  if (versions.isPending) return <Panel title={title} meta={meta} testId="mig-workbook"><Skeleton width="100%" height={120} /></Panel>;
  if (versions.isError) return <Panel title={title} meta={meta} testId="mig-workbook"><ErrorFrame onRetry={() => void versions.refetch()}>{t("The runs could not be read.")}</ErrorFrame></Panel>;
  if (versions.data.length === 0) return <Panel title={title} meta={meta} testId="mig-workbook"><EmptyFrame>{t("No run has finished yet. A finished run is needed before the workbook can be filled.")}</EmptyFrame></Panel>;
  const report = check.data;
  const missing = report?.sheets.flatMap((s) => s.unmapped.filter((u) => u.mandatory).map((u) => ({ sheet: s.name, ...u }))) ?? [];
  const learned = report?.sheets.flatMap((s) => s.unmapped.filter((u) => u.learned).map((u) => ({ sheet: s.name, ...u }))) ?? [];
  const change = () => { check.reset(); exp.reset(); update.reset(); };
  return (
    <Panel title={title} meta={meta} testId="mig-workbook">
      <Steps label={t("Workbook steps")} testId="mig-workbook-steps" labels={[t("Choose the run and workbook"), t("Check what fits"), t("Export the data")]} current={report ? 2 : file ? 1 : 0} />
      <form className="m2-rfilters" onSubmit={(e) => { e.preventDefault(); if (file) check.mutate({ run, file }); }}>
        <label>{t("Run")}
          <select className="m2-sel" value={run} onChange={(e) => { setPicked(e.target.value); change(); }}>
            {versions.data.map(({ v, system }) => {
              const when = formatDate(v.run_at, "date");
              const objects = (v.metadata?.modules ?? []).map(moduleText).join(", ");
              const name = v.run_number == null ? t("{system}, {date}", { system, date: when }) : t("{system} run {n}, {date}", { system, n: int(v.run_number), date: when });
              return <option key={v.id} value={v.id}>{objects ? `${name}, ${objects}` : name}</option>;
            })}
          </select>
        </label>
        <label>{t("Workbook or load file")}
          <input type="file" accept={WORKBOOK_TYPES} data-testid="mig-workbook-file" onChange={(e) => { setFile(e.target.files?.[0] ?? null); change(); }} />
        </label>
        <button type="submit" className="m2-btn m2-next" disabled={!file || check.isPending}>{check.isPending ? t("Checking the workbook") : t("Check the workbook")}</button>
      </form>
      <p className="m2-meta">{t("The check only reads the workbook. Nothing is stored and nothing is exported yet.")}</p>
      {check.isError ? <p role="alert">{errorSentence(check.error, t("The workbook could not be checked."))}</p> : null}
      {report ? (
        <>
          <p data-testid="mig-workbook-summary">{t("{ready} rows are ready and {held} are held back. {filled} of {sheets} sheets can be filled, with {matched} of {columns} columns.", { ready: int(report.summary.ready), held: int(report.summary.held), filled: int(report.summary.filled_sheets), sheets: int(report.summary.sheets), matched: int(report.summary.matched_columns), columns: int(report.summary.columns) })}</p>
          <p className="m2-meta" data-testid="mig-workbook-format">{t("Read as: {format}", { format: WORKBOOK_FORMAT[report.format.id]?.() ?? report.format.id })}</p>
          {report.format.skipped.length > 0 ? <p role="status" data-testid="mig-workbook-skipped">{t("Not read from the ZIP: {files}", { files: report.format.skipped.join(", ") })}</p> : null}
          {report.summary.mandatory_sheets_empty > 0 ? <p role="status" data-testid="mig-workbook-empty">{t("{n} mandatory sheets have no ready rows. The load tool will refuse the file until they do.", { n: int(report.summary.mandatory_sheets_empty) })}</p> : null}
          {report.summary.mapped_values > 0 ? <p className="m2-meta" data-testid="mig-workbook-mapped">{t("{n} values were changed by confirmed value mappings.", { n: int(report.summary.mapped_values) })}</p> : null}
          {report.summary.mandatory_unmapped > 0 ? <p role="status" data-testid="mig-workbook-required">{t("{n} required columns have no data in this run. The new system will refuse those rows until the columns are filled.", { n: int(report.summary.mandatory_unmapped) })}</p> : null}
          {learned.length > 0 && report?.learned?.system_id ? (
            <div role="status" data-testid="mig-workbook-learned">
              <p>{t("{n} columns in this workbook were not in the extraction. Meridian has added them, so the next run fetches them from the source system.", { n: int(learned.length) })}</p>
              <Disclose title={t("Columns added to the extraction")} hint={t("{n} columns", { n: int(learned.length) })}>
                <Table title={t("Columns added to the extraction")} head={[t("Sheet"), t("Column")]}>
                  {learned.map((m) => (
                    <tr key={`${m.sheet}-${m.id}`}>
                      <th scope="row" className="m2-card-lead">{m.sheet}</th>
                      <td data-label={t("Column")}><Coded code={m.id} text={m.label} /></td>
                    </tr>
                  ))}
                </Table>
              </Disclose>
              {update.isSuccess ? (
                <p data-testid="mig-workbook-updating">{t("A new run has started. When it finishes, choose it above and check the workbook again.")}</p>
              ) : can("trigger_sync") ? (
                <p><button type="button" className="m2-btn m2-next" data-testid="mig-workbook-update" disabled={update.isPending} onClick={() => update.mutate({ system_id: report.learned!.system_id!, modules: report.learned!.modules })}>{update.isPending ? t("Starting the run") : t("Update the run")}</button></p>
              ) : (
                <p className="m2-meta">{t("Ask someone who can start extractions to update the run.")}</p>
              )}
            </div>
          ) : null}
          <Table title={t("Sheets in the workbook")} head={[t("Sheet"), t("Filled from"), t("Columns filled"), t("Rows ready"), t("Held back"), t("Required columns with no data")]}>
            {report.sheets.map((s) => (
              <tr key={s.name}>
                <th scope="row" className="m2-card-lead">{s.name}</th>
                <td data-label={t("Filled from")}>{s.table ? <Coded code={s.table} text={labelText(s.table)} first /> : t("Not filled")}</td>
                <td data-label={t("Columns filled")}>{t("{a} of {b}", { a: int(s.matched), b: int(s.columns) })}</td>
                <td data-label={t("Rows ready")}>{int(s.ready)}</td>
                <td data-label={t("Held back")}>{int(s.held)}</td>
                <td data-label={t("Required columns with no data")}>{int(s.unmapped.filter((u) => u.mandatory).length)}</td>
              </tr>
            ))}
          </Table>
          {missing.length > 0 ? (
            <Disclose title={t("Required columns with no data")} hint={t("{n} columns", { n: int(missing.length) })}>
              <Table title={t("Required columns with no data")} head={[t("Sheet"), t("Column")]}>
                {missing.map((m) => (
                  <tr key={`${m.sheet}-${m.id}`}>
                    <th scope="row" className="m2-card-lead">{m.sheet}</th>
                    <td data-label={t("Column")}><Coded code={m.id} text={m.label} /></td>
                  </tr>
                ))}
              </Table>
            </Disclose>
          ) : null}
          {report.country_unchecked.length > 0 ? (
            <Disclose title={t("Country rules not checked")} hint={t("{n} columns", { n: int(report.country_unchecked.length) })}>
              <p className="m2-meta">{t("These columns are required for some countries, but the sheet does not show each record's country. Check them before the load.")}</p>
              <Table title={t("Country rules not checked")} head={[t("Sheet"), t("Column")]}>
                {report.country_unchecked.map((m) => (
                  <tr key={`${m.sheet}-${m.id}`}>
                    <th scope="row" className="m2-card-lead">{m.sheet}</th>
                    <td data-label={t("Column")}><Coded code={m.id} text={m.label} /></td>
                  </tr>
                ))}
              </Table>
            </Disclose>
          ) : null}
          {report.held_total > 0 ? (
            <Disclose title={t("Rows held back")} hint={report.held.length < report.held_total ? t("First {n} of {total}", { n: int(report.held.length), total: int(report.held_total) }) : t("{n} rows", { n: int(report.held_total) })}>
              <p className="m2-meta">{Object.entries(report.reasons).map(([r, n]) => `${holdText(r)}: ${int(n)}`).join(", ")}</p>
              <Table title={t("Rows held back")} head={[t("Record"), t("Sheet"), t("Column"), t("Why")]}>
                {report.held.map((h, i) => (
                  <tr key={i}>
                    <th scope="row" className="m2-card-lead">{h.record}</th>
                    <td data-label={t("Sheet")}>{h.sheet}</td>
                    <td data-label={t("Column")}>{h.field}</td>
                    <td data-label={t("Why")}>{holdText(h.reason)}</td>
                  </tr>
                ))}
              </Table>
            </Disclose>
          ) : null}
          <p className="m2-meta">{t("The export holds the ready rows in the workbook's own columns, and held rows on a Held back tab. In the same format, held rows travel in a separate file. Every export is recorded in the audit log. The workbook itself is not stored.")}</p>
          <p>
            {report.format.same ? <><button type="button" className="m2-btn m2-next" disabled={exp.isPending || report.summary.filled_sheets === 0} onClick={() => exp.mutate("source")}>{t("Export in the same format")}</button>{" "}</> : null}
            <button type="button" className="m2-btn" disabled={exp.isPending || report.summary.filled_sheets === 0} onClick={() => exp.mutate("xlsx")}>{t("Export as Excel")}</button>{" "}
            <button type="button" className="m2-btn" disabled={exp.isPending || report.summary.filled_sheets === 0} onClick={() => exp.mutate("csv")}>{t("Export as CSV files")}</button>
          </p>
        </>
      ) : null}
    </Panel>
  );
}

function LoadFilesPanel({ run }: { run: MigrationRun }) {
  const { can, shared, viewAs } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const exp = useMutation({
    mutationFn: (fmt: "csv" | "xlsx") => exportLoadFiles(run.id, fmt),
    onSuccess: (name) => {
      toast.show(t("Load files saved as {name}", { name }));
      void qc.invalidateQueries({ queryKey: ["migration"] });
    },
    onError: (e) => toast.show(errorSentence(e, t("The load files could not be prepared.")), "error"),
  });
  if (!can("export") || shared || viewAs) return null;
  return (
    <Panel title={t("Load files")} meta={t("Records without blocking gaps, shaped for the target system")} testId="mig-load-files">
      <p>
        <button type="button" className="m2-btn" disabled={exp.isPending} onClick={() => exp.mutate("csv")}>{t("Download as CSV files")}</button>{" "}
        <button type="button" className="m2-btn" disabled={exp.isPending} onClick={() => exp.mutate("xlsx")}>{t("Download as Excel")}</button>
      </p>
    </Panel>
  );
}

const RECON_REASON: Record<string, () => string> = {
  no_key_in_dictionary: () => t("No key in the data dictionary"),
  key_not_in_load: () => t("Key field not in the load files"),
  target_extract_incomplete: () => t("Target extraction incomplete"),
  target_extract_partial: () => t("Target extraction partial"),
  table_not_extracted: () => t("Table not extracted from the target"),
  key_not_in_target_extract: () => t("Key field not in the target extraction"),
};
const ACTUAL_WHY: Record<string, () => string> = {
  no_target_analysis: () => t("The target system has no completed analysis."),
  no_target_findings_for_module: () => t("The target analysis has no findings for this object."),
};
const RECON_KIND: Record<ReconKind, () => string> = {
  missing: () => t("Missing in target"),
  differing: () => t("Different in target"),
  unexpected: () => t("Held back but present"),
};
const RECON_STATUS: Record<string, () => string> = { ...STATUS_TEXT, done: () => t("Done") };
const signed = (n: number) => `${n > 0 ? "+" : ""}${f1(n)}`;
const signedInt = (n: number) => `${n > 0 ? "+" : ""}${int(n)}`;

/** Post-load reconciliation: what the load files carried against the target system's latest extraction (migration.py /reconcile). */
function PostLoadPanel({ run }: { run: MigrationRun }) {
  const { can, shared, viewAs } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const fixture = useFixture();
  const [kind, setKind] = useState<ReconKind>("missing");
  const [table, setTable] = useState("");
  const [offset, setOffset] = useState(0);
  const q = useQuery({
    queryKey: ["migration", "recon", run.id, fixture], queryFn: () => getReconciliation(run.id), staleTime: 30_000,
    retry, refetchInterval: (c) => (c.state.data?.status === "queued" || c.state.data?.status === "running" ? 5_000 : false),
  });
  const done = q.data?.status === "done";
  const rec = useQuery({
    queryKey: ["migration", "recon-records", run.id, table, kind, offset, fixture], queryFn: () => getReconciliationRecords(run.id, { table: table || undefined, kind, offset, limit: PAGE }),
    staleTime: 60_000, retry, enabled: done,
  });
  const start = useMutation({
    mutationFn: () => startReconciliation(run.id),
    onSuccess: () => { toast.show(t("Reconciliation started")); void qc.invalidateQueries({ queryKey: ["migration", "recon", run.id] }); },
    onError: (e) => toast.show(errorSentence(e, t("The reconciliation could not be started.")), "error"),
  });
  const extract = useMutation({
    mutationFn: () => extractMigrationTarget(run.id),
    onSuccess: () => { toast.show(t("Extraction of the target system started")); void qc.invalidateQueries({ queryKey: ["migration", "recon", run.id] }); },
    onError: (e) => toast.show(errorSentence(e, t("The target system could not be extracted.")), "error"),
  });
  const exp = useMutation({
    mutationFn: () => exportReconciliation(run.id),
    onSuccess: (name) => toast.show(t("Reconciliation saved as {name}", { name })),
    onError: (e) => toast.show(errorSentence(e, t("The reconciliation could not be prepared.")), "error"),
  });
  const act = !shared && !viewAs;
  const d = q.data;
  const sum = d?.summary ?? {};
  const rules = (d?.scores ?? []).flatMap((m) => m.reasons.map((r) => ({ ...r, module: m.module })));
  const tablesWithRecords = (d?.tables ?? []).filter((x) => x.comparable);
  const fieldText = new Map(tablesWithRecords.flatMap((x) => x.fields.map((f) => [f.field, f.description ?? undefined] as const)));
  return (
    <Panel title={t("Post-load reconciliation")} meta={d?.completed_at ? t("Compared on {date}", { date: formatDate(d.completed_at, "date") }) : t("Load files against the target system")} testId="mig-post-load">
      <p>
        {can("analyse") && act ? <button type="button" className="m2-btn" disabled={start.isPending || d?.status === "queued" || d?.status === "running"} onClick={() => start.mutate()}>{t("Run reconciliation")}</button> : null}{" "}
        {can("export") && act && done ? <button type="button" className="m2-btn" disabled={exp.isPending} onClick={() => exp.mutate()}>{t("Download as Excel")}</button> : null}
      </p>
      {q.isPending ? <Skeleton width="100%" height={120} /> : status(q.error) === 404 ? (
        <EmptyFrame>{t("This run has not been reconciled against the target system.")}</EmptyFrame>
      ) : q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("This reconciliation could not be read.")}</ErrorFrame> : (
        <>
          {d!.stale ? (
            <p role="status" className="m2-meta" data-testid="mig-post-load-stale">
              <strong>{t("Out of date.")}</strong>{" "}{t("The target system was extracted again on {date}, after this comparison. Run the reconciliation again to compare with the newer extraction.", { date: formatDate(d!.latest_target_synced_at, "date") })}
            </p>
          ) : null}
          {d!.needs_target_extraction ? (
            <p role="status" className="m2-meta" data-testid="mig-post-load-needs-target">
              {t("The target system has not been extracted yet, so there is nothing to compare the load files with. The comparison starts by itself when the extraction has been analysed.")}{" "}
              {can("trigger_sync") && act ? <button type="button" className="m2-btn" disabled={extract.isPending} onClick={() => extract.mutate()}>{t("Extract the target system")}</button> : null}
            </p>
          ) : !done ? (
            <p className="m2-meta">{RECON_STATUS[d!.status]?.() ?? d!.status}{d!.error_detail ? ` ${d!.error_detail}` : ""}</p>
          ) : (
            <>
              <p className="m2-meta">
                {t("Target extraction of {date}.", { date: formatDate(d!.target_synced_at, "date") })}{" "}
                {t("{n} of {m} tables compared: {e} expected, {f} found, {x} missing, {u} held back but present, {w} fields differ.", {
                  n: int(sum.comparable ?? 0), m: int(sum.tables ?? 0), e: int(sum.expected ?? 0), f: int(sum.found ?? 0), x: int(sum.missing ?? 0), u: int(sum.unexpected ?? 0), w: int(sum.differing_fields ?? 0),
                })}
              </p>
              {d!.automatic ? <p className="m2-meta" data-testid="mig-post-load-auto">{t("Started automatically when the target system was analysed again.")}</p> : null}
              {d!.previous ? (
                <p className="m2-meta" data-testid="mig-post-load-change">
                  {t("Since the comparison of {date}: {x} missing ({dx}), {w} fields differ ({dw}), {f} found ({df}).", {
                    date: formatDate(d!.previous.created_at, "date"),
                    x: int(sum.missing ?? 0), dx: signedInt((sum.missing ?? 0) - (d!.previous.summary.missing ?? 0)),
                    w: int(sum.differing_fields ?? 0), dw: signedInt((sum.differing_fields ?? 0) - (d!.previous.summary.differing_fields ?? 0)),
                    f: int(sum.found ?? 0), df: signedInt((sum.found ?? 0) - (d!.previous.summary.found ?? 0)),
                  })}
                </p>
              ) : null}
              <p className="m2-meta">
                {sum.basis === "snapshot"
                  ? t("Compared against the files exported on {date}.", { date: formatDate(sum.snapshot_exported_at ?? null, "date") })
                  : t("Rebuilt from the current field mappings. No export snapshot was kept for this run, so a mapping changed after the load shows as a difference.")}
                {sum.snapshot_skipped ? ` ${t("The export snapshot could not be used, so the expected side was rebuilt from the current field mappings.")}` : ""}
                {sum.newest_export_no_copy ? ` ${t("The latest export has no copy on file, so it is not the basis of this comparison.")}` : ""}
              </p>
              <Table title={t("Data quality score, source, projected and actual")} head={[t("Object"), t("Source"), t("Projected"), t("Actual in target")]}>
                {d!.scores.map((m) => (
                  <tr key={m.module}>
                    <th scope="row" className="m2-card-lead">{formatModuleName(m.module)}</th>
                    <td data-label={t("Source")}>{f1(m.source)}</td>
                    <td data-label={t("Projected")}>{f1(m.projected)}</td>
                    <td data-label={t("Actual in target")}>{m.actual === null ? <span className="m2-meta">{f1(null)} {m.actual_reason ? ACTUAL_WHY[m.actual_reason]?.() ?? m.actual_reason : ""}</span> : f1(m.actual)}</td>
                  </tr>
                ))}
              </Table>
              {rules.length > 0 ? (
                <Table title={t("Rules that moved the actual score")} head={[t("Object"), t("Rule"), t("Source pass rate"), t("Target pass rate"), t("Change")]}>
                  {rules.map((r) => (
                    <tr key={`${r.module}-${r.check_id}`}>
                      <th scope="row" className="m2-card-lead">{formatModuleName(r.module)}</th>
                      <td data-label={t("Rule")}><Coded code={r.check_id} text={r.description} /></td>
                      <td data-label={t("Source pass rate")}>{f1(r.source_pass_rate)}</td>
                      <td data-label={t("Target pass rate")}>{f1(r.target_pass_rate)}</td>
                      <td data-label={t("Change")}>{signed(r.change)}</td>
                    </tr>
                  ))}
                </Table>
              ) : null}
              <Table title={t("Records per target table")} head={[t("Table"), t("Expected"), t("Found"), t("Missing"), t("Held back but present"), t("Fields that differ")]}>
                {d!.tables.map((x) => (
                  <tr key={x.table}>
                    <th scope="row" className="m2-card-lead"><Coded code={x.table} text={x.description} first /></th>
                    {x.comparable ? (
                      <>
                        <td data-label={t("Expected")}>{int(x.expected)}</td>
                        <td data-label={t("Found")}>{int(x.found)}</td>
                        <td data-label={t("Missing")}>{int(x.missing)}</td>
                        <td data-label={t("Held back but present")}>{int(x.unexpected)}</td>
                        <td data-label={t("Fields that differ")}>{int(x.fields.reduce((a, f) => a + f.differing, 0))}</td>
                      </>
                    ) : (
                      <td colSpan={5} data-label={t("Not compared")}>{t("Not compared")}: <Coded code={x.reason ?? ""} text={x.reason ? RECON_REASON[x.reason]?.() : undefined} /></td>
                    )}
                  </tr>
                ))}
              </Table>
              <Table title={t("Fields compared")} head={[t("Table"), t("Field"), t("Compared"), t("Matched"), t("Different")]}>
                {tablesWithRecords.flatMap((x) => x.fields.map((f) => (
                  <tr key={`${x.table}-${f.field}`}>
                    <th scope="row" className="m2-card-lead"><Coded code={x.table} text={x.description} first /></th>
                    <td data-label={t("Field")}><Coded code={f.field} text={f.description} first /></td>
                    <td data-label={t("Compared")}>{f.in_target_extract ? int(f.compared) : t("Not in the target extraction")}</td>
                    <td data-label={t("Matched")}>{f.in_target_extract ? int(f.matched) : f1(null)}</td>
                    <td data-label={t("Different")}>{f.in_target_extract ? int(f.differing) : f1(null)}</td>
                  </tr>
                )))}
              </Table>
              <p>
                {(Object.keys(RECON_KIND) as ReconKind[]).map((k) => (
                  <button key={k} type="button" className="m2-btn" aria-pressed={kind === k} onClick={() => { setKind(k); setOffset(0); }}>{RECON_KIND[k]()}</button>
                ))}{" "}
                <select aria-label={t("Table")} value={table} onChange={(e) => { setTable(e.target.value); setOffset(0); }}>
                  <option value="">{t("All tables")}</option>
                  {tablesWithRecords.map((x) => <option key={x.table} value={x.table}>{x.table} {x.description}</option>)}
                </select>
              </p>
              {rec.isPending ? <Skeleton width="100%" height={120} /> : rec.isError ? <ErrorFrame onRetry={() => void rec.refetch()}>{t("This list could not be read.")}</ErrorFrame> : rec.data.rows.length === 0 ? (
                <EmptyFrame>{t("No records in this list.")}</EmptyFrame>
              ) : (
                <>
                  <Table title={RECON_KIND[kind]()} head={[t("Record"), t("Load file record"), t("Field"), t("Expected"), t("Found")]}>
                    {rec.data.rows.map((r) => (
                      <tr key={`${r.source_record}-${r.key}-${r.field}`}>
                        <th scope="row" className="m2-card-lead"><Coded code={r.key} text={undefined} first /></th>
                        <td data-label={t("Load file record")}>{r.source_record ?? f1(null)}</td>
                        <td data-label={t("Field")}>{r.field ? <Coded code={r.field} text={fieldText.get(r.field)} first /> : f1(null)}</td>
                        <td data-label={t("Expected")}>{r.withheld ? t("Withheld") : r.expected ?? f1(null)}</td>
                        <td data-label={t("Found")}>{r.withheld ? t("Withheld") : r.found ?? f1(null)}</td>
                      </tr>
                    ))}
                  </Table>
                  <Pager offset={offset} total={rec.data.total} onMove={setOffset} />
                  {rec.data.capped ? <p className="m2-meta">{t("Only the first {n} records of each table and kind are kept; the counts above are complete.", { n: int(rec.data.record_cap ?? 0) })}</p> : null}
                </>
              )}
            </>
          )}
        </>
      )}
    </Panel>
  );
}

function FindingsPanel({ run, gapTypes }: { run: MigrationRun; gapTypes: string[] }) {
  const { can } = useV2Session();
  const toast = useToast();
  const [module, setModule] = useUrlParam<string>("gap_module", "");
  const [gap, setGap] = useState("");
  const [sev, setSev] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const filt = { module: module || undefined, gap_type: gap || undefined, severity: sev || undefined, search: search || undefined };
  const q = useMig(["findings", run.id, filt, offset], () => getMigrationFindings(run.id, { ...filt, limit: PAGE, offset }));
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setOffset(0); };
  const exp = useMutation({
    mutationFn: () => exportMigrationFindings(run.id, filt),
    onError: (e) => toast.show(errorSentence(e, t("The gaps could not be exported.")), "error"),
  });
  const title = t("Field-level gaps");
  const total = q.data?.total ?? 0;
  return (
    <Panel title={title} meta={q.data ? t("{n} gaps", { n: int(total) }) : undefined} testId="mig-findings">
      <form className="m2-rfilters" onSubmit={(e) => e.preventDefault()}>
        <label>{t("Object")}
          <select className="m2-sel" value={module} onChange={(e) => reset(setModule)(e.target.value)}>
            <option value="">{t("All")}</option>
            {run.modules.map((m) => <option key={m} value={m}>{formatModuleName(m)}</option>)}
          </select>
        </label>
        <label>{t("Kind of gap")}
          <select className="m2-sel" value={gap} onChange={(e) => reset(setGap)(e.target.value)}>
            <option value="">{t("All")}</option>
            {gapTypes.map((g) => <option key={g} value={g}>{gapText(g)}</option>)}
          </select>
        </label>
        <label>{t("Severity")}
          <select className="m2-sel" value={sev} onChange={(e) => reset(setSev)(e.target.value)}>
            <option value="">{t("All")}</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label>{t("Search")}
          <input className="m2-inp" type="search" value={search} onChange={(e) => reset(setSearch)(e.target.value)} />
        </label>
        {can("export") ? <button type="button" className="m2-btn" disabled={exp.isPending} onClick={() => exp.mutate()}>{t("Export to Excel")}</button> : null}
      </form>
      {q.isPending ? <Skeleton width="100%" height={120} /> : q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("This list could not be read.")}</ErrorFrame> : q.data.items.length === 0 ? (
        <EmptyFrame>{t("No gap matches these filters.")}</EmptyFrame>
      ) : (
        <>
          <Table title={title} head={[t("Record"), t("Gap"), t("Severity"), t("Source field"), t("Source value"), t("Target field"), t("Target value"), t("Why")]}>
            {q.data.items.map((f, i) => (
              <tr key={`${f.record_key}-${f.source_field}-${i}`}>
                <th scope="row" className="m2-card-lead">{f.record_key ? <Coded code={f.record_key} text={formatModuleName(f.module)} first /> : formatModuleName(f.module)}</th>
                <td data-label={t("Gap")}>{gapText(f.gap_type)}</td>
                <td data-label={t("Severity")}><Sev severity={f.severity} /></td>
                <td data-label={t("Source field")}><Field name={f.source_field} /></td>
                <td data-label={t("Source value")}>{f.source_value ?? f1(null)}</td>
                <td data-label={t("Target field")}><Field name={f.target_field} /></td>
                <td data-label={t("Target value")}>{f.target_value ?? f1(null)}</td>
                <td data-label={t("Why")}>{f.detail ?? f1(null)}</td>
              </tr>
            ))}
          </Table>
          <Pager offset={offset} total={total} onMove={setOffset} />
        </>
      )}
    </Panel>
  );
}

function Pager({ offset, total, onMove }: { offset: number; total: number; onMove: (n: number) => void }) {
  if (total <= PAGE) return null;
  return (
    <p className="m2-meta">
      <button type="button" className="m2-btn" disabled={offset === 0} onClick={() => onMove(Math.max(0, offset - PAGE))}>{t("Previous")}</button>{" "}
      {t("{from} to {to} of {n}", { from: int(offset + 1), to: int(Math.min(total, offset + PAGE)), n: int(total) })}{" "}
      <button type="button" className="m2-btn" disabled={offset + PAGE >= total} onClick={() => onMove(offset + PAGE)}>{t("Next")}</button>
    </p>
  );
}

function RecordsPanel({ run }: { run: MigrationRun }) {
  const [which, setWhich] = useState<"load_fail" | "load_ready">("load_fail");
  const [offset, setOffset] = useState(0);
  const q = useMig(["records", run.id, which, offset], () => getMigrationRecords(run.id, which, offset));
  const title = which === "load_fail" ? t("Records that would not load") : t("Records ready to load");
  return (
    <Panel title={t("Records")} meta={q.data ? t("{n} records", { n: int(q.data.total) }) : undefined} testId="mig-records">
      <p>
        <button type="button" className="m2-btn" aria-pressed={which === "load_fail"} onClick={() => { setWhich("load_fail"); setOffset(0); }}>{t("Would not load")}</button>{" "}
        <button type="button" className="m2-btn" aria-pressed={which === "load_ready"} onClick={() => { setWhich("load_ready"); setOffset(0); }}>{t("Ready to load")}</button>
      </p>
      {q.isPending ? <Skeleton width="100%" height={120} /> : q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("This list could not be read.")}</ErrorFrame> : q.data.rows.length === 0 ? (
        <EmptyFrame>{t("No records in this list.")}</EmptyFrame>
      ) : (
        <>
          <Table title={title} head={[t("Record"), t("Object"), t("Table"), t("Reasons")]}>
            {q.data.rows.map((r) => (
              <tr key={`${r.source_table}-${r.record_key}`}>
                <th scope="row" className="m2-card-lead"><Coded code={r.record_key} text={undefined} first /></th>
                <td data-label={t("Object")}>{formatModuleName(r.module)}</td>
                <td data-label={t("Table")}>{r.source_table ?? f1(null)}</td>
                <td data-label={t("Reasons")}>{r.reasons.length === 0 ? f1(null) : <ul className="m2-plain">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>}</td>
              </tr>
            ))}
          </Table>
          <Pager offset={offset} total={q.data.total} onMove={setOffset} />
        </>
      )}
    </Panel>
  );
}

function FieldMapPanel({ modules }: { modules: string[] }) {
  const { can } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const [module, setModule] = useUrlParam<string>("map_module", modules[0] ?? "material_master");
  const [valueField, setValueField] = useState<string | null>(null);
  const q = useMig(["field-map", module], () => getFieldMap(module, "s4hana"));
  const done = (msg: string) => () => { toast.show(msg); void qc.invalidateQueries({ queryKey: ["migration", "field-map"] }); };
  const fail = (msg: string) => (e: unknown) => toast.show(errorSentence(e, msg), "error");
  const confirm = useMutation({ mutationFn: (id: string) => updateFieldMapping(id, { is_confirmed: true }), onSuccess: done(t("The mapping is confirmed.")), onError: fail(t("The mapping could not be confirmed.")) });
  const remove = useMutation({ mutationFn: deleteFieldMapping, onSuccess: done(t("The mapping was removed.")), onError: fail(t("The mapping could not be removed.")) });
  const seed = useMutation({ mutationFn: () => seedFieldMap(module, "s4hana"), onSuccess: done(t("The field map was proposed from the source.")), onError: fail(t("The field map could not be proposed.")) });
  const edit = can("analyse");
  const title = t("Field map");
  const rows = q.data?.mappings ?? [];
  const deltas = rows.map(fieldDelta);
  const count = (f: (d: Delta[], i: number) => boolean) => deltas.filter(f).length;
  const bars = [
    { key: "same", label: t("Load as read"), value: count((d) => d[0].kind === "same" || d.every((x) => x.kind === "longer")), tone: "pass" as const },
    { key: "change", label: t("Definition changes"), value: count((d) => d.some((x) => x.kind !== "longer" && x.kind !== "same" && x.kind !== "dropped" && x.kind !== "unknown")), tone: "warn" as const },
    { key: "open", label: t("Change with no transformation yet"), value: count((_, i) => needsTransform(rows[i])), tone: "crit" as const },
    { key: "values", label: t("Values translated by a value map"), value: rows.filter((m) => m.value_map).length, tone: "data" as const },
    { key: "dropped", label: t("Not carried to the target"), value: count((d) => d[0].kind === "dropped"), tone: "data" as const },
    { key: "unconfirmed", label: t("Not confirmed"), value: rows.filter((m) => !m.is_confirmed).length, tone: "warn" as const },
  ].map((b) => ({ ...b, text: int(b.value) }));
  return (
    <Panel title={title} meta={t("Each field as read from the source, the target field it loads into, what changes between them and the transformation that bridges it")} testId="mig-field-map">
      <form className="m2-rfilters" onSubmit={(e) => e.preventDefault()}>
        <label>{t("Object")}
          <select className="m2-sel" value={module} onChange={(e) => { setModule(e.target.value); setValueField(null); }}>
            {[...new Set([...modules, module])].map((m) => <option key={m} value={m}>{formatModuleName(m)}</option>)}
          </select>
        </label>
        {edit ? <button type="button" className="m2-btn" disabled={seed.isPending} onClick={() => seed.mutate()}>{t("Propose from the source")}</button> : null}
      </form>
      {q.isPending ? <Skeleton width="100%" height={120} /> : q.isError ? (
        status(q.error) === 403 ? <EmptyFrame>{t("Your role cannot read the field map.")}</EmptyFrame> : <ErrorFrame onRetry={() => void q.refetch()}>{t("The field map could not be read.")}</ErrorFrame>
      ) : rows.length === 0 ? <EmptyFrame>{t("No field is mapped for this object yet.")}</EmptyFrame> : (
        <>
        <CcHBars label={t("Delta between source and target")} testId="mig-delta-bars" rows={bars} />
        <Table title={title} head={[t("Source field"), t("Source definition"), t("Target field"), t("Target definition"), t("Delta"), t("Transformation"), t("Confirmed"), ""]}>
          {rows.map((m, i) => {
            const target = m.dest_table && m.dest_field ? `${m.dest_table}.${m.dest_field}` : null;
            const open = needsTransform(m);
            return (
              <tr key={m.id}>
                <th scope="row" className="m2-card-lead"><Field name={m.source_field} def={m.source_def} /></th>
                <td data-label={t("Source definition")} className="m2-mono">{defText(m.source_def)}</td>
                <td data-label={t("Target field")}>{target ? <Field name={target} def={m.target_def} /> : t("Not migrated")}</td>
                <td data-label={t("Target definition")} className="m2-mono">{defText(m.target_def)}</td>
                <td data-label={t("Delta")}><ul className="m2-plain">{deltas[i].map((d) => <li key={d.kind}>{DELTA[d.kind](d)}</li>)}</ul></td>
                <td data-label={t("Transformation")}>
                  <ul className="m2-plain">
                    {m.transform_note ? <li>{m.transform_note}</li> : null}
                    {m.value_map ? <li>{t("Values translated by a value map")}</li> : null}
                    {open ? <li><Sev severity="high" /> {t("Needs a transformation")}</li> : !m.transform_note && !m.value_map ? <li>{t("Copied as read")}</li> : null}
                    {m.origin ? <li className="m2-meta">{ORIGIN[m.origin]?.() ?? m.origin}</li> : null}
                  </ul>
                </td>
                <td data-label={t("Confirmed")}>{m.is_confirmed ? t("Yes") : t("No")}</td>
                <td>
                  {m.value_map && target ? <button type="button" className="m2-btn" aria-pressed={valueField === target} onClick={() => setValueField(target)}>{t("Values")}</button> : null}{" "}
                  {edit && !m.is_confirmed ? <button type="button" className="m2-btn" onClick={() => confirm.mutate(m.id)}>{t("Confirm")}</button> : null}{" "}
                  {edit ? <button type="button" className="m2-btn" onClick={() => remove.mutate(m.id)}>{t("Remove")}</button> : null}
                </td>
              </tr>
            );
          })}
        </Table>
        </>
      )}
      {valueField ? <ValueMap module={module} field={valueField} /> : null}
    </Panel>
  );
}

function ValueMap({ module, field }: { module: string; field: string }) {
  const { can, id: me } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const runs = useMig(["runs"], getMigrationRuns);
  const runId = runs.data?.runs.find((r) => analysed(r) && r.modules.includes(module))?.id ?? null;
  const saved = useMig(["value-map", module, field], () => getValueMap(module, field));
  const cands = useMig(["candidates", runId, field], () => getValueCandidates(runId!, field), runId !== null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const done = (msg: string) => () => { toast.show(msg); setDraft({}); void qc.invalidateQueries({ queryKey: ["migration", "value-map"] }); };
  const save = useMutation({
    mutationFn: () => saveValueMap(module, field, Object.entries(draft).filter(([, v]) => v.trim()).map(([source_value, target_value]) => ({ source_value, target_value: target_value.trim() }))),
    onSuccess: done(t("The values were proposed. A second person approves them before the load uses them.")),
    onError: (e) => toast.show(errorSentence(e, t("The value map could not be saved.")), "error"),
  });
  const remove = useMutation({ mutationFn: deleteValueEntry, onSuccess: done(t("The value was removed from the map.")), onError: (e) => toast.show(errorSentence(e, t("The value could not be removed.")), "error") });
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approve" | "reject" }) => decideValueEntry(id, decision),
    onSuccess: (r) => done(r.status === "confirmed" ? t("The value is approved. The next load uses it.") : t("The proposed value was rejected."))(),
    onError: (e) => toast.show(errorSentence(e, t("The decision could not be saved.")), "error"),
  });
  // Four eyes: analysts propose values, a different approver confirms them; the load reads confirmed values only.
  const edit = can("analyse");
  const approver = can("approve");
  const byValue = new Map((saved.data?.entries ?? []).map((e) => [e.source_value, e]));
  const values = cands.data?.values ?? (saved.data?.entries ?? []).map((e) => ({ source_value: e.source_value, records: null as number | null }));
  const title = t("Value map for {field}", { field });
  return (
    <section aria-label={title} data-testid="mig-value-map">
      <h3 className="m2-h3">{title}</h3>
      {saved.isPending ? <Skeleton width="100%" height={80} /> : saved.isError ? <ErrorFrame onRetry={() => void saved.refetch()}>{t("The value map could not be read.")}</ErrorFrame> : values.length === 0 ? (
        <EmptyFrame>{t("No source values are known for this field yet.")}</EmptyFrame>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Table title={title} head={[t("Source value"), t("Records"), t("Target value"), t("Status"), ""]}>
            {values.map((v) => {
              const e = byValue.get(v.source_value);
              return (
                <tr key={v.source_value}>
                  <th scope="row" className="m2-card-lead">{v.source_value}</th>
                  <td data-label={t("Records")} className="m2-num">{int(v.records)}</td>
                  <td data-label={t("Target value")}>
                    {edit ? (
                      <input className="m2-inp" aria-label={t("Target value for {v}", { v: v.source_value })} value={draft[v.source_value] ?? e?.target_value ?? ""} onChange={(ev) => setDraft((d) => ({ ...d, [v.source_value]: ev.target.value }))} />
                    ) : e?.target_value ?? f1(null)}
                  </td>
                  <td data-label={t("Status")} data-testid={`mig-vm-status-${v.source_value}`}>
                    {!e ? t("Not mapped") : e.status === "proposed" ? t("Waits for a second person") : t("Approved")}
                  </td>
                  <td>
                    {approver && e?.status === "proposed" && e.proposed_by !== me ? (
                      <>
                        <button type="button" className="m2-btn" data-testid={`mig-vm-approve-${v.source_value}`} disabled={decide.isPending} onClick={() => decide.mutate({ id: e.id, decision: "approve" })}>{t("Approve")}</button>{" "}
                        <button type="button" className="m2-btn" data-testid={`mig-vm-reject-${v.source_value}`} disabled={decide.isPending} onClick={() => decide.mutate({ id: e.id, decision: "reject" })}>{t("Reject")}</button>{" "}
                      </>
                    ) : null}
                    {approver && e ? <button type="button" className="m2-btn" onClick={() => remove.mutate(e.id)}>{t("Remove")}</button> : null}
                  </td>
                </tr>
              );
            })}
          </Table>
          {edit ? <button type="submit" className="m2-btn m2-next" disabled={save.isPending || Object.keys(draft).length === 0}>{t("Propose these values")}</button> : null}
        </form>
      )}
    </section>
  );
}

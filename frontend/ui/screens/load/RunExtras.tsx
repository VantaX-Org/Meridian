"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { t } from "@/lib/v2/i18n";
import { useFixture } from "@/lib/api/v2/fixture";
import {
  checkTargetWorkbook, getReconciliationRecords, getValueCandidates, getValueMap, saveValueMap,
  type LoadOptions, type ReconKind, type ReconRecord, type ReconTable, type WorkbookHeldRow, type WorkbookReport,
} from "@/lib/api/v2/migration";
import { errorSentence } from "@/lib/api/v2/client";
import { Button, Confirm, DataTable, EmptyState, Field, FieldChip, FileDrop, Input, Select, Stepper, StatTile, Toggle, useToast } from "@/ui/kit";
import { useCan } from "@/ui/screens/orphans/useCan";
import { Gate, humanize } from "./common";
import { invalidateLoad } from "./hooks";

/** Source values of one target field that have no target value yet, and the proposals that fill them. */
export function ValueMapping({ id, modules }: { id: string; modules: string[] }) {
  const fx = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan()("analyse");
  const [mdl, setMdl] = useState(modules[0] ?? "");
  const [field, setField] = useState("");
  const [asked, setAsked] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [ask, setAsk] = useState(false);
  const cands = useQuery({ queryKey: ["ui", "load", fx, "candidates", id, asked], queryFn: () => getValueCandidates(id, asked), enabled: !!asked });
  const known = useQuery({ queryKey: ["ui", "load", fx, "valuemap", mdl || modules[0] || "", asked], queryFn: () => getValueMap(mdl || modules[0] || "", asked), enabled: !!asked });
  const entries = Object.entries(draft).filter(([, v]) => v.trim());
  const save = useMutation({
    mutationFn: () => saveValueMap(mdl || modules[0] || "", asked, entries.map(([source_value, target_value]) => ({ source_value, target_value: target_value.trim() }))),
    onSuccess: (r) => { toast(t("{n, plural, one {# value proposed} other {# values proposed}}. A second person approves them.", { n: r.saved }), "good"); setDraft({}); setAsk(false); invalidateLoad(qc); },
    onError: (e) => { setAsk(false); toast(errorSentence(e, t("The action failed")), "bad"); },
  });
  const pending = (known.data?.entries ?? []).filter((e) => e.status === "proposed").length;
  return (
    <>
      <div className="mx-links">
        <Field label={t("Object")}><Select value={mdl || modules[0] || ""} onChange={(e) => setMdl(e.target.value)} options={modules.map((m) => ({ value: m, label: `${m} ${humanize(m)}` }))} /></Field>
        <Field label={t("Target field")}><Input placeholder="MARA.MTART" value={field} onChange={(e) => setField(e.target.value)} /></Field>
        <Button onClick={() => { setAsked(field.trim().toUpperCase()); setDraft({}); }} disabled={!field.trim()}>{t("Find unmapped values")}</Button>
      </div>
      {!asked ? <EmptyState heading={t("Choose a target field")} body={t("Enter the target field to see the source values that still need a target value.")} /> : (
        <Gate loading={cands.isLoading} error={cands.isError} retry={() => void cands.refetch()} what={t("the unmapped values")}>
          {cands.data?.values.length ? (
            <>
              <DataTable<{ source_value: string; records: number }>
                label={t("Unmapped source values")}
                rows={cands.data.values}
                rowKey={(v) => v.source_value}
                columns={[
                  { key: "s", label: t("Source value"), sort: (v) => v.source_value, render: (v) => <code className="mx-code">{v.source_value}</code> },
                  { key: "r", label: t("Records"), align: "end", sort: (v) => v.records, render: (v) => v.records.toLocaleString() },
                  { key: "t", label: t("Target value"), render: (v) => <Input aria-label={t("Target value for {v}", { v: v.source_value })} value={draft[v.source_value] ?? ""} onChange={(e) => setDraft({ ...draft, [v.source_value]: e.target.value })} /> },
                ]}
              />
              <div className="mx-actions">
                <Button variant="primary" onClick={() => setAsk(true)} disabled={!can || !entries.length || save.isPending} title={can ? undefined : t("You need the analyse permission to propose value mappings")}>{t("Propose mappings")}</Button>
                {!can ? <span className="mx-muted">{t("You need the analyse permission to propose value mappings")}</span> : null}
                {pending ? <span className="mx-muted">{t("{n, plural, one {# proposal waits for a second person} other {# proposals wait for a second person}}", { n: pending })}</span> : null}
              </div>
            </>
          ) : <EmptyState heading={t("No unmapped values")} body={t("Every source value of {f} has a target value.", { f: asked })} />}
        </Gate>
      )}
      <Confirm open={ask} title={t("Propose {n, plural, one {# value mapping} other {# value mappings}} for {f}?", { n: entries.length, f: asked })} confirmLabel={t("Propose mappings")} cancelLabel={t("Cancel")} onConfirm={() => save.mutate()} onCancel={() => setAsk(false)}>
        <p>{t("Nothing is loaded. Each mapping stays a proposal until a different person approves it in the value map.")}</p>
        <ul>{entries.map(([s, v]) => <li key={s}><code className="mx-code">{s}</code> {"=>"} <code className="mx-code">{v}</code></li>)}</ul>
      </Confirm>
    </>
  );
}

const KINDS: ReconKind[] = ["missing", "differing", "unexpected"];
const kindLabel = (k: ReconKind) => (k === "missing" ? t("Missing") : k === "differing" ? t("Differing") : t("Unexpected"));
const PAGE = 50;

/** The missing, differing and unexpected records of the latest reconciliation, one table and kind at a time. */
export function ReconRecords({ id, tables }: { id: string; tables: ReconTable[] }) {
  const fx = useFixture();
  const [table, setTable] = useState("");
  const [kind, setKind] = useState("");
  const [real, setReal] = useState(false);
  const [offset, setOffset] = useState(0);
  const q = { table: table || undefined, kind: (kind || undefined) as ReconKind | undefined, real_only: real, offset, limit: PAGE };
  const r = useQuery({ queryKey: ["ui", "load", fx, "reconrecords", id, q], queryFn: () => getReconciliationRecords(id, q) });
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setOffset(0); };
  const total = r.data?.total ?? 0;
  return (
    <>
      <div className="mx-links">
        <Field label={t("Table")}><Select value={table} onChange={(e) => reset(setTable)(e.target.value)} options={[{ value: "", label: t("All tables") }, ...tables.map((x) => ({ value: x.table, label: x.table }))]} /></Field>
        <Field label={t("Kind")}><Select value={kind} onChange={(e) => reset(setKind)(e.target.value)} options={[{ value: "", label: t("All kinds") }, ...KINDS.map((k) => ({ value: k, label: kindLabel(k) }))]} /></Field>
        <Toggle label={t("Real differences only")} checked={real} onChange={reset(setReal)} />
      </div>
      <Gate loading={r.isLoading} error={r.isError} retry={() => void r.refetch()} what={t("the reconciliation records")}>
        {r.data?.rows.length ? (
          <>
            {r.data.capped ? <p className="mx-muted">{t("Each table keeps at most {n} records per kind. The totals above are not capped.", { n: r.data.record_cap ?? 0 })}</p> : null}
            <DataTable<ReconRecord>
              label={t("Reconciliation records")}
              rows={r.data.rows}
              rowKey={(x) => `${x.kind}|${x.source_record ?? ""}|${x.key}|${x.field ?? ""}`}
              columns={[
                { key: "k", label: t("Kind"), render: (x) => kindLabel(x.kind) },
                { key: "s", label: t("Source record"), render: (x) => <code className="mx-code">{x.source_record ?? x.key}</code> },
                { key: "f", label: t("Field"), render: (x) => (x.field ? <FieldChip code={x.field} description={x.ddic?.description} /> : "") },
                { key: "e", label: t("Expected"), render: (x) => (x.withheld ? t("Withheld") : x.expected ?? "") },
                { key: "o", label: t("Found"), render: (x) => (x.withheld ? t("Withheld") : x.found ?? "") },
                { key: "c", label: t("Cause"), render: (x) => (x.cause ? humanize(x.cause) : "") },
              ]}
            />
            <div className="mx-actions">
              <Button onClick={() => setOffset(Math.max(0, offset - PAGE))} disabled={offset === 0}>{t("Previous")}</Button>
              <span className="mx-muted">{t("{from} to {to} of {total}", { from: offset + 1, to: Math.min(offset + PAGE, total), total: total.toLocaleString() })}</span>
              <Button onClick={() => setOffset(offset + PAGE)} disabled={offset + PAGE >= total}>{t("Next")}</Button>
            </div>
          </>
        ) : <EmptyState heading={t("No records match")} body={t("Change the table or kind to see other records.")} />}
      </Gate>
    </>
  );
}

/** Reads the new system's workbook against the run before anything is exported. Nothing is stored. */
export function TargetWorkbook({ versionId }: { versionId: string | null }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"full" | "incremental">("full");
  const [since, setSince] = useState("");
  const [report, setReport] = useState<WorkbookReport | null>(null);
  const opts: LoadOptions = { load_mode: mode, since: since || null };
  const check = useMutation({
    mutationFn: () => checkTargetWorkbook(versionId as string, file as File, opts),
    onSuccess: (r) => { setReport(r); toast(t("Workbook checked"), "good"); },
    onError: (e) => toast(errorSentence(e, t("The workbook could not be checked")), "bad"),
  });
  const step = report ? 2 : file ? 1 : 0;
  if (!versionId) return <EmptyState heading={t("This run has no source extraction")} body={t("The workbook is checked against the extraction a run read. Choose a run that has one.")} />;
  return (
    <>
      <Stepper label={t("Check a workbook")} current={step} steps={[{ id: "file", label: t("Choose the workbook") }, { id: "check", label: t("Check it") }, { id: "review", label: t("Review what is held") }]} />
      <FileDrop accept=".xlsx,.xlsm,.csv,.zip" label={t("The new system's workbook")} status={file ? file.name : t("Drop the workbook here or choose a file")} onFile={(f) => { setFile(f); setReport(null); }} />
      <div className="mx-links">
        <Field label={t("Load mode")}><Select value={mode} onChange={(e) => setMode(e.target.value as "full" | "incremental")} options={[{ value: "full", label: t("Full load") }, { value: "incremental", label: t("Incremental load") }]} /></Field>
        {mode === "incremental" ? <Field label={t("Changed since")}><Input type="date" value={since} onChange={(e) => setSince(e.target.value)} /></Field> : null}
        <Button variant="primary" onClick={() => check.mutate()} disabled={!file || check.isPending}>{t("Check the workbook")}</Button>
      </div>
      <p className="mx-muted">{t("The check reads the workbook against this run. Nothing is stored and nothing is loaded.")}</p>
      {report ? (
        <>
          <dl className="mx-tiles">
            <StatTile label={t("Rows")} value={report.summary.rows.toLocaleString()} note={`${t("Ready")}: ${report.summary.ready.toLocaleString()}`} />
            <StatTile label={t("Held")} value={report.summary.held.toLocaleString()} note={`${t("Columns matched")}: ${report.summary.matched_columns} / ${report.summary.columns}`} />
            <StatTile label={t("Mandatory columns unmapped")} value={String(report.summary.mandatory_unmapped)} note={`${t("Sheets filled")}: ${report.summary.filled_sheets} / ${report.summary.sheets}`} />
          </dl>
          <DataTable
            label={t("Workbook sheets")}
            rows={report.sheets}
            rowKey={(s) => s.name}
            columns={[
              { key: "n", label: t("Sheet"), sort: (s) => s.name, render: (s) => (s.table ? <FieldChip code={s.table} description={s.name} /> : s.name) },
              { key: "c", label: t("Columns matched"), align: "end", render: (s) => `${s.matched} / ${s.columns}` },
              { key: "r", label: t("Rows"), align: "end", sort: (s) => s.rows, render: (s) => s.rows.toLocaleString() },
              { key: "y", label: t("Ready"), align: "end", sort: (s) => s.ready, render: (s) => s.ready.toLocaleString() },
              { key: "h", label: t("Held"), align: "end", sort: (s) => s.held, render: (s) => s.held.toLocaleString() },
            ]}
          />
          {report.held.length ? (
            <DataTable<WorkbookHeldRow>
              label={t("Held rows")}
              rows={report.held}
              rowKey={(h) => `${h.sheet}|${h.record}|${h.field}`}
              columns={[
                { key: "s", label: t("Sheet"), render: (h) => h.sheet },
                { key: "r", label: t("Record"), render: (h) => <code className="mx-code">{h.record}</code> },
                { key: "f", label: t("Field"), render: (h) => <FieldChip code={h.field} /> },
                { key: "w", label: t("Reason"), render: (h) => humanize(h.reason) },
              ]}
            />
          ) : <EmptyState heading={t("No rows are held")} body={t("Every row of the workbook can be filled.")} />}
          {report.held_total > report.held.length ? <p className="mx-muted">{t("The first {n} held rows are shown of {total}.", { n: report.held.length, total: report.held_total.toLocaleString() })}</p> : null}
        </>
      ) : null}
    </>
  );
}

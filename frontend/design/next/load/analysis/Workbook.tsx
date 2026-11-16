"use client";

/**
 * The new system's workbook or load file is the input, and a finished run fills it in that file's own columns
 * (migration.py /target-workbook). The check comes first, so the user sees what fits before anything is exported.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { checkTargetWorkbook, exportTargetWorkbook, type WorkbookFormat, type WorkbookSheet, type WorkbookHeldRow } from "@/lib/api/v2/migration";
import { extractObjects, getVersionsPage } from "@/lib/api/v2/runs";
import { formatDate } from "@/lib/format";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { useLandscape } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import { Button, Code, EmptyState, ErrorState, Skeleton, useToast } from "../../kit";
import { Disclose, Panel } from "../parts";
import { Labelled, Steps, Table, sheetColumns, useMig, type SheetColumn } from "./shared";

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
export const WORKBOOK_TYPES = ".xlsx,.xlsm,.xltx,.xltm,.xls,.xlsb,.ods,.xml,.csv,.tsv,.txt,.dat,.zip";

const key = (r: SheetColumn) => `${r.sheet}-${r.id}`;
function ColumnTable({ rows, caption }: { rows: SheetColumn[]; caption: string }) {
  return <Table rows={rows} columns={sheetColumns()} rowKey={key} rowLabel={key} caption={caption} />;
}

export function TargetWorkbookPanel() {
  const { can, shared, viewAs } = useV2Session();
  const toast = useToast();
  const systems = useLandscape(null).data?.systems ?? [];
  const allowed = can("export") && !shared && !viewAs && systems.length > 0;
  // the run started by "Update the run": when it finishes, the workbook is checked again on it
  const [waiting, setWaiting] = useState("");
  const versions = useMig(["target-workbook-runs", systems.map((s) => s.id)], async () => {
    const pages = await Promise.all(systems.map(async (s) => ({ s, page: await getVersionsPage({ system_id: s.id, limit: 50 }) })));
    return pages
      .flatMap(({ s, page }) => page.versions.filter((v) => v.status.includes("complete")).map((v) => ({ v, system: s.name })))
      .sort((a, b) => b.v.run_at.localeCompare(a.v.run_at));
  }, allowed, waiting ? 15_000 : false);
  const [picked, setPicked] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const run = picked || versions.data?.[0]?.v.id || "";
  const check = useMutation({ mutationFn: (a: { run: string; file: File }) => checkTargetWorkbook(a.run, a.file) });
  const exp = useMutation({
    mutationFn: (fmt: WorkbookFormat) => exportTargetWorkbook(run, file as File, fmt, check.data?.format.written_as),
    onSuccess: (name) => toast({ text: t("Workbook data saved as {name}", { name }), tone: "good" }),
    onError: (e) => toast({ text: errorSentence(e, t("The workbook data could not be prepared.")), tone: "bad" }),
  });
  const update = useMutation({
    mutationFn: (l: { system_id: string; modules: string[] }) => extractObjects(l.system_id, l.modules, true),
    onSuccess: (r) => setWaiting(r.job_id.replace(/^dl-/, "")),
    onError: (e) => toast({ text: errorSentence(e, t("The run could not be started.")), tone: "bad" }),
  });
  // once the run started by "Update the run" shows as complete, check the workbook on it once
  const done = Boolean(waiting && versions.data?.some(({ v }) => v.id === waiting));
  const checked = useRef("");
  useEffect(() => {
    if (!done || !file || checked.current === waiting) return;
    checked.current = waiting;
    check.mutate({ run: waiting, file }, { onSettled: () => { setPicked(waiting); setWaiting(""); update.reset(); } });
  }, [done, file, waiting, update, check]);
  const title = t("Workbook from the new system");
  const meta = t("Fill the new system's workbook or load file from a finished run");
  if (!allowed) {
    const why = systems.length === 0 && can("export") && !shared && !viewAs
      ? t("No source system is connected yet. Connect one and finish a run before a workbook can be filled.")
      : t("Your role cannot export migration data, so the workbook cannot be filled here.");
    return <Panel title={title} meta={meta} testId="mig-workbook-locked"><EmptyState heading={why} /></Panel>;
  }
  if (versions.isPending) return <Panel title={title} meta={meta} testId="mig-workbook"><Skeleton /></Panel>;
  if (versions.isError) return <Panel title={title} meta={meta} testId="mig-workbook"><ErrorState sentence={t("The runs could not be read.")} onRetry={() => void versions.refetch()} /></Panel>;
  if (versions.data.length === 0) return <Panel title={title} meta={meta} testId="mig-workbook"><EmptyState heading={t("No run has finished yet. A finished run is needed before the workbook can be filled.")} /></Panel>;
  const report = check.data;
  const missing = report?.sheets.flatMap((s) => s.unmapped.filter((u) => u.mandatory).map((u) => ({ sheet: s.name, ...u }))) ?? [];
  const learned = report?.sheets.flatMap((s) => s.unmapped.filter((u) => u.learned).map((u) => ({ sheet: s.name, ...u }))) ?? [];
  const ambiguous = report?.sheets.flatMap((s) => s.unmapped.filter((u) => u.candidates?.length).map((u) => ({ sheet: s.name, ...u }))) ?? [];
  const change = () => { check.reset(); exp.reset(); update.reset(); };
  const none = exp.isPending || (report?.summary.filled_sheets ?? 0) === 0;
  return (
    <Panel title={title} meta={meta} testId="mig-workbook">
      <Steps label={t("Workbook steps")} testId="mig-workbook-steps" labels={[t("Choose the run and workbook"), t("Check what fits"), t("Export the data")]} current={report ? 2 : file ? 1 : 0} />
      <form className="nx-ld-filters" onSubmit={(e) => { e.preventDefault(); if (file) check.mutate({ run, file }); }}>
        <Labelled label={t("Run")}>
          <select className="nx-input" value={run} onChange={(e) => { setPicked(e.target.value); change(); }}>
            {versions.data.map(({ v, system }) => {
              const when = formatDate(v.run_at, "date");
              const objects = (v.metadata?.modules ?? []).map(moduleText).join(", ");
              const name = v.run_number == null ? t("{system}, {date}", { system, date: when }) : t("{system} run {n}, {date}", { system, n: int(v.run_number), date: when });
              return <option key={v.id} value={v.id}>{objects ? `${name}, ${objects}` : name}</option>;
            })}
          </select>
        </Labelled>
        <Labelled label={t("Workbook or load file")}>
          <input type="file" className="nx-input" accept={WORKBOOK_TYPES} data-testid="mig-workbook-file" onChange={(e) => { setFile(e.target.files?.[0] ?? null); change(); }} />
        </Labelled>
        <Button type="submit" variant="primary" disabled={!file} loading={check.isPending} loadingLabel={t("Checking the workbook")}>{t("Check the workbook")}</Button>
      </form>
      <p className="nx-ld-meta">{t("The check reads the workbook and keeps only the column names it learns. The workbook itself is not stored, and nothing is exported yet.")}</p>
      {check.isError ? <p role="alert">{errorSentence(check.error, t("The workbook could not be checked."))}</p> : null}
      {report ? (
        <>
          <p data-testid="mig-workbook-summary">{t("{ready} rows are ready and {held} are held back. {filled} of {sheets} sheets can be filled, with {matched} of {columns} columns.", { ready: int(report.summary.ready), held: int(report.summary.held), filled: int(report.summary.filled_sheets), sheets: int(report.summary.sheets), matched: int(report.summary.matched_columns), columns: int(report.summary.columns) })}</p>
          <p className="nx-ld-meta" data-testid="mig-workbook-format">{t("Read as: {format}", { format: WORKBOOK_FORMAT[report.format.id]?.() ?? report.format.id })}</p>
          {report.format.skipped.length > 0 ? <p role="status" data-testid="mig-workbook-skipped">{t("Not read from the ZIP: {files}", { files: report.format.skipped.join(", ") })}</p> : null}
          {report.summary.mandatory_sheets_empty > 0 ? <p role="status" data-testid="mig-workbook-empty">{t("{n} mandatory sheets have no ready rows. The load tool will refuse the file until they do.", { n: int(report.summary.mandatory_sheets_empty) })}</p> : null}
          {report.summary.mapped_values > 0 ? <p className="nx-ld-meta" data-testid="mig-workbook-mapped">{t("{n} values were changed by confirmed value mappings.", { n: int(report.summary.mapped_values) })}</p> : null}
          {report.summary.mandatory_unmapped > 0 ? <p role="status" data-testid="mig-workbook-required">{t("{n} required columns have no data in this run. The new system will refuse those rows until the columns are filled.", { n: int(report.summary.mandatory_unmapped) })}</p> : null}
          {learned.length > 0 && report.learned?.system_id ? (
            <div role="status" data-testid="mig-workbook-learned">
              <p>{t("{n} columns in this workbook were not in the extraction. Meridian has added them, so the next run fetches them from the source system.", { n: int(learned.length) })}</p>
              <Disclose summary={`${t("Columns added to the extraction")}, ${t("{n} columns", { n: int(learned.length) })}`}>
                <ColumnTable rows={learned} caption={t("Columns added to the extraction")} />
              </Disclose>
              {update.isSuccess ? (
                <p data-testid="mig-workbook-updating">{t("A new run has started. When it finishes, Meridian checks the workbook again on it, so the added columns are filled.")}{" "}
                  <Button variant="secondary" size={32} data-testid="mig-workbook-stop" onClick={() => { setWaiting(""); update.reset(); }}>{t("Stop waiting")}</Button></p>
              ) : can("trigger_sync") ? (
                <div className="nx-ld-actions"><Button variant="primary" data-testid="mig-workbook-update" loading={update.isPending} loadingLabel={t("Starting the run")} onClick={() => update.mutate({ system_id: report.learned?.system_id ?? "", modules: report.learned?.modules ?? [] })}>{t("Update the run")}</Button></div>
              ) : (
                <p className="nx-ld-meta">{t("Ask someone who can start extractions to update the run.")}</p>
              )}
            </div>
          ) : null}
          {learned.length > 0 && !report.learned?.system_id ? (
            <p role="status" data-testid="mig-workbook-learned-nosystem">{t("{n} columns in this workbook are not in the extraction, but this run is not tied to a source system, so they cannot be added. Start the run from a connected system.", { n: int(learned.length) })}</p>
          ) : null}
          {(report.learned?.missing ?? 0) > 0 ? (
            <p role="status" data-testid="mig-workbook-not-in-system">{t("{n} columns ask for fields the source system did not return on the last run, so another run will not fill them. Ask the system owner whether the field exists, or fill these columns in the new system.", { n: int(report.learned?.missing ?? 0) })}</p>
          ) : null}
          {ambiguous.length > 0 ? (
            <div role="status" data-testid="mig-workbook-ambiguous">
              <p>{t("{n} columns name a field that more than one of this object's tables holds, so Meridian did not choose one. Write the table in the column header, as TABLE-FIELD, and check the workbook again.", { n: int(ambiguous.length) })}</p>
              <Table
                rows={ambiguous}
                rowKey={key}
                rowLabel={key}
                caption={t("Columns on more than one table")}
                columns={[...sheetColumns(), { id: "tables", label: t("Tables that hold it"), cell: (m) => (m.candidates ?? []).map((tb) => <Code key={tb} code={tb} text={labelText(tb)} />) }]}
              />
            </div>
          ) : null}
          <Table<WorkbookSheet>
            rows={report.sheets}
            rowKey={(s) => s.name}
            rowLabel={(s) => s.name}
            caption={t("Sheets in the workbook")}
            columns={[
              { id: "sheet", label: t("Sheet"), cell: (s) => s.name },
              { id: "from", label: t("Filled from"), cell: (s) => (s.table ? <Code code={s.table} text={labelText(s.table)} /> : t("Not filled")) },
              { id: "cols", label: t("Columns filled"), cell: (s) => t("{a} of {b}", { a: int(s.matched), b: int(s.columns) }) },
              { id: "ready", label: t("Rows ready"), align: "end", cell: (s) => int(s.ready) },
              { id: "held", label: t("Held back"), align: "end", cell: (s) => int(s.held) },
              { id: "req", label: t("Required columns with no data"), align: "end", cell: (s) => int(s.unmapped.filter((u) => u.mandatory).length) },
            ]}
          />
          {missing.length > 0 ? (
            <Disclose summary={`${t("Required columns with no data")}, ${t("{n} columns", { n: int(missing.length) })}`}>
              <ColumnTable rows={missing} caption={t("Required columns with no data")} />
            </Disclose>
          ) : null}
          {report.country_unchecked.length > 0 ? (
            <Disclose summary={`${t("Country rules not checked")}, ${t("{n} columns", { n: int(report.country_unchecked.length) })}`}>
              <p className="nx-ld-meta">{t("These columns are required for some countries, but the sheet does not show each record's country. Check them before the load.")}</p>
              <ColumnTable rows={report.country_unchecked} caption={t("Country rules not checked")} />
            </Disclose>
          ) : null}
          {report.held_total > 0 ? (
            <Disclose summary={`${t("Rows held back")}, ${report.held.length < report.held_total ? t("First {n} of {total}", { n: int(report.held.length), total: int(report.held_total) }) : t("{n} rows", { n: int(report.held_total) })}`}>
              <p className="nx-ld-meta">{Object.entries(report.reasons).map(([r, n]) => `${holdText(r)}: ${int(n)}`).join(", ")}</p>
              <Table<WorkbookHeldRow & { i: number }>
                rows={report.held.map((h, i) => ({ ...h, i }))}
                rowKey={(h) => String(h.i)}
                rowLabel={(h) => h.record}
                caption={t("Rows held back")}
                columns={[
                  { id: "record", label: t("Record"), cell: (h) => h.record },
                  { id: "sheet", label: t("Sheet"), cell: (h) => h.sheet },
                  { id: "column", label: t("Column"), cell: (h) => h.field },
                  { id: "why", label: t("Why"), cell: (h) => holdText(h.reason) },
                ]}
              />
            </Disclose>
          ) : null}
          <p className="nx-ld-meta">{t("The export holds the ready rows in the workbook's own columns, and held rows on a Held back tab. In the same format, held rows travel in a separate file. Every export is recorded in the audit log. The workbook itself is not stored.")}</p>
          <div className="nx-ld-actions">
            {report.format.same ? <Button variant="primary" disabled={none} onClick={() => exp.mutate("source")}>{t("Export in the same format")}</Button> : null}
            <Button variant="secondary" disabled={none} onClick={() => exp.mutate("xlsx")}>{t("Export as Excel")}</Button>
            <Button variant="secondary" disabled={none} onClick={() => exp.mutate("csv")}>{t("Export as CSV files")}</Button>
          </div>
        </>
      ) : null}
    </Panel>
  );
}

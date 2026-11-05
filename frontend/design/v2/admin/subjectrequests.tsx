"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  downloadSubjectExport,
  dryRunErasure,
  executeErasure,
  searchSubject,
  subjectError,
  type SubjectErase,
  type SubjectLedgerRow,
  type SubjectResult,
} from "@/lib/api/v2/subject-requests";
import { refreshAdmin, useSubjectRequests } from "@/lib/v2/admin-queries";
import { relTime } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { Grid, type GridColumn } from "../Grid";
import { EmptyFrame, Mono } from "../parts";
import { AdminPage, Block, Fld, Loaded, NeedsPermission, Note, StatusWord, useCan } from "./kit";

const CONFIRM_WORD = "ERASE";
const MIN_REASON = 10;

/** What each table holds, so no code stands alone. The keys are the table names the API reports. */
const TABLE: Record<string, string> = {
  get finding_records() { return t("Records that failed a rule, per run"); },
  get record_issues() { return t("Open and closed issues on a record"); },
  get work_records() { return t("Work items and their status per record"); },
  get record_hashes() { return t("Change-detection fingerprints per record"); },
  get remediation_items() { return t("Remediation tasks for a record"); },
  get rule_suppressions() { return t("Rules switched off for one record"); },
  get data_anomalies() { return t("Statistical anomalies on a record"); },
  get config_matches() { return t("Configuration matches on a record"); },
  get migration_gap_findings() { return t("Migration readiness gaps on a record"); },
  get record_fixes() { return t("Fixes proposed or applied to a record"); },
  get data_duplicates() { return t("Duplicate pairs found by the checks"); },
  get dedup_candidates() { return t("Duplicate candidates awaiting a decision"); },
  get match_scores() { return t("Match scores between two records"); },
  get record_relationships() { return t("Links from one record to another"); },
  get master_records() { return t("Golden records and their history"); },
  get survivorship_decisions() { return t("Which source value won for a golden record"); },
  get cleaning_queue() { return t("Cleansing queue: values before and after"); },
  get cleaning_audit() { return t("Cleansing audit: values before and after"); },
  get change_request_field_changes() { return t("Old and new values in change requests"); },
  get mdm_merge_events() { return t("Merge events and the records merged"); },
  get migration_export_files() { return t("Record keys listed in migration export files"); },
  get audit_log() { return t("Audit log entries that carry the exact key"); },
};
const SCRUBBED = new Set(["cleaning_queue", "cleaning_audit", "change_request_field_changes", "mdm_merge_events", "migration_export_files", "audit_log"]);

type Row = { table: string; rows: number };

const COLUMNS: GridColumn<Row>[] = [
  { id: "table", get header() { return t("Table"); }, width: 240, pin: true, locked: true, cell: (r) => <Mono>{r.table}</Mono> },
  { id: "about", get header() { return t("What it holds"); }, width: 380, cell: (r) => (r.table === "extracts" ? t("Rows in extract files of the object store") : TABLE[r.table] ?? r.table) },
  { id: "rows", get header() { return t("Rows"); }, width: 90, numeric: true, cell: (r) => r.rows },
  { id: "how", get header() { return t("On erasure"); }, width: 260, cell: (r) => (r.table === "extracts" ? t("Rows removed, file rewritten") : SCRUBBED.has(r.table) ? t("Row kept, key and values cleared") : t("Row deleted")) },
];

const rowsOf = (r: SubjectResult): Row[] => [...Object.entries(r.rows_by_table).map(([table, rows]) => ({ table, rows })), { table: "extracts", rows: r.extracts.rows }];

const LEDGER_COLUMNS: GridColumn<SubjectLedgerRow>[] = [
  { id: "when", get header() { return t("When"); }, width: 170, pin: true, locked: true, cell: (r) => relTime(r.created_at) },
  { id: "kind", get header() { return t("Request"); }, width: 190, cell: (r) => (r.kind === "access" ? t("Search or export") : r.dry_run ? t("Erasure dry run") : t("Erasure")) },
  { id: "rows", get header() { return t("Rows"); }, width: 90, numeric: true, cell: (r) => Object.values(r.rows_by_table).reduce((a, b) => a + b, 0) + r.extract_rows },
  { id: "status", get header() { return t("Status"); }, width: 130, cell: (r) => <StatusWord tone={r.status === "done" ? "go" : "at-risk"}>{r.status === "done" ? t("Done") : t("Incomplete")}</StatusWord> },
  { id: "who", get header() { return t("By"); }, width: 200, cell: (r) => r.actor ?? "—" },
  { id: "reason", get header() { return t("Reason"); }, width: 320, cell: (r) => r.reason ?? "—" },
  { id: "id", get header() { return t("Request id"); }, width: 300, defaultHidden: true, cell: (r) => <Mono>{r.request_id}</Mono> },
];

const LIMITS: (() => string)[] = [
  () => t("Meridian does not delete from SAP. Erase the record there as well."),
  () => t("A later extraction brings the record back. There is no suppression list yet, so erase it again after the next extraction or remove it in SAP first."),
  () => t("Backups of the database and the object store are out of reach. They age out on their own schedule."),
  () => t("Raw uploads, generated reports and archived files are not searched or changed."),
  () => t("Extract files are matched on the full record key only. A record without a key (row numbers) cannot be found in them."),
  () => t("Change requests, sample key lists on learned rules and process variants, and the language model audit log are not changed. The audit log holds no record keys."),
  () => t("The search matches record keys, not names or other personal values: those are masked or dropped before findings are stored. A bare value matches the FIELD=value parts of keys in three tables only."),
];

/** Admin › Data subject requests: find, export and erase what is held for one record key, dry run first. */
export function SubjectRequestsSection() {
  const can = useCan();
  const qc = useQueryClient();
  const allowed = can("manage_settings");
  const ledger = useSubjectRequests(allowed);
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [found, setFound] = useState<SubjectResult | null>(null);
  const [dry, setDry] = useState<SubjectErase | null>(null);
  const [asked, setAsked] = useState("");
  const [word, setWord] = useState("");
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<SubjectErase | null>(null);
  if (!allowed) return <AdminPage title={t("Data subject requests")}><NeedsPermission what={t("Data subject requests")} permission="manage_settings" /></AdminPage>;

  const clear = () => {
    setError(null);
    setNotice(null);
    setFound(null);
    setDry(null);
    setDone(null);
    setWord("");
    setReason("");
  };
  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      void refreshAdmin(qc, "subjectrequests");
    } catch (e) {
      setError(subjectError(e, fallback));
    } finally {
      setBusy(false);
    }
  };
  const subj = subject.trim();
  const search = () => {
    clear();
    void run(async () => {
      setFound(await searchSubject(subj));
      setAsked(subj);
    }, t("The search failed."));
  };
  const exportIt = () =>
    void run(async () => {
      const name = await downloadSubjectExport(asked);
      setNotice(t("Saved {name}. The export is recorded in the request list.", { name }));
    }, t("The export failed."));
  const dryRun = () =>
    void run(async () => {
      setDone(null);
      setDry(await dryRunErasure(asked));
    }, t("The dry run failed."));
  const erase = () =>
    void run(async () => {
      if (!dry) return;
      const out = await executeErasure(asked, dry.request_id, word, reason.trim());
      setDone(out);
      setDry(null);
      setWord("");
      setReason("");
    }, t("The erasure failed."));
  const changed = subj !== asked;
  const none = found !== null && found.total_rows === 0;
  const ready = dry !== null && dry.total_rows > 0 && word === CONFIRM_WORD && reason.trim().length >= MIN_REASON;

  return (
    <AdminPage
      title={t("Data subject requests")}
      lead={t("Find what is held for one record key, export it, or erase it. Erasure always starts with a dry run that lists exactly what would go. No language model sees any of it.")}
    >
      <Block title={t("What erasure cannot do")} hint={t("Read this before you erase.")}>
        <Note tone="warn">
          <ul className="m2-plain">
            {LIMITS.map((l, i) => (
              <li key={i}>{l()}</li>
            ))}
          </ul>
        </Note>
      </Block>

      <Block title={t("Find")} hint={t("Enter a full record key such as FIELD=value, or the value alone. The subject is never stored: the request list holds a keyed hash and counts.")}>
        <div className="m2-fgrid">
          <Fld label={t("Record key or value")} wide mono>
            <input type="text" value={subject} maxLength={300} autoComplete="off" onChange={(e) => setSubject(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && subj && !busy) search(); }} />
          </Fld>
        </div>
        <div className="m2-adm-acts">
          <button type="button" className="m2-btn m2-strong" disabled={busy || !subj} onClick={search}>{t("Search")}</button>
        </div>
        {error ? <Note tone="bad">{error}</Note> : null}
        {notice ? <p role="status">{notice}</p> : null}
        {found ? (
          <>
            <p role="status">
              {none
                ? t("Nothing is held for this key.")
                : t("{rows} rows across {tables} tables and {files} extract files, for {keys} record keys.", { rows: found.total_rows, tables: Object.keys(found.rows_by_table).length, files: found.extracts.files, keys: found.keys.length })}
            </p>
            {!found.extracts.complete ? <Note tone="warn">{t("Not every extract file could be read ({skipped} skipped, {errors} with errors), so the extract count may be low.", { skipped: found.extracts.skipped, errors: found.extracts.errors })}</Note> : null}
            <Grid<Row> id="admin-subject-found" ariaLabel={t("Where the subject appears")} columns={COLUMNS} rows={rowsOf(found)} rowId={(r) => r.table} emptyFrame={<EmptyFrame>{t("Nothing is held for this key.")}</EmptyFrame>} />
            <div className="m2-adm-acts">
              <button type="button" className="m2-btn" disabled={busy || changed || none} onClick={exportIt}>{t("Export what is held")}</button>
              <button type="button" className="m2-btn" disabled={busy || changed || none} onClick={dryRun}>{t("Dry run an erasure")}</button>
            </div>
            {changed ? <p className="m2-adm-hint">{t("The key changed. Search again before you export or erase.")}</p> : null}
          </>
        ) : null}
      </Block>

      {dry ? (
        <Block title={t("Erase: dry run")} hint={t("Nothing has been deleted. This is exactly what the erasure removes. The dry run is valid for 24 hours and for the records found now.")}>
          <Grid<Row> id="admin-subject-dry" ariaLabel={t("What would be erased")} columns={COLUMNS} rows={rowsOf(dry)} rowId={(r) => r.table} emptyFrame={<EmptyFrame>{t("Nothing would be erased.")}</EmptyFrame>} />
          <div className="m2-fgrid">
            <Fld label={t("Reason, at least {n} characters", { n: MIN_REASON })} wide>
              <textarea rows={2} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
            </Fld>
            <Fld label={t("Type {word} to confirm", { word: CONFIRM_WORD })} mono>
              <input type="text" value={word} autoComplete="off" onChange={(e) => setWord(e.target.value)} />
            </Fld>
          </div>
          <div className="m2-adm-acts">
            <button type="button" className="m2-btn m2-strong m2-crit" disabled={busy || !ready} onClick={erase}>{t("Erase permanently")}</button>
          </div>
        </Block>
      ) : null}

      {done ? (
        <Block title={t("Erased")}>
          <p role="status">
            <StatusWord tone={done.complete ? "go" : "at-risk"}>{done.complete ? t("Done") : t("Incomplete")}</StatusWord>{" "}
            {t("{rows} rows removed or cleared.", { rows: done.total_rows })}
          </p>
          {!done.complete ? <Note tone="warn">{t("Some extract files could not be rewritten. The database part is final. Run the search again to see what remains.")}</Note> : null}
          <Grid<Row> id="admin-subject-done" ariaLabel={t("What was erased")} columns={COLUMNS} rows={rowsOf(done)} rowId={(r) => r.table} emptyFrame={<EmptyFrame>{t("Nothing was erased.")}</EmptyFrame>} />
        </Block>
      ) : null}

      <Block title={t("Requests so far")} hint={t("Counts and a keyed hash only. The record key is never kept.")}>
        <Loaded q={ledger} what={t("The request list")}>
          {(rows) => (
            <Grid<SubjectLedgerRow> id="admin-subject-ledger" ariaLabel={t("Requests so far")} columns={LEDGER_COLUMNS} rows={rows} rowId={(r) => r.request_id} emptyFrame={<EmptyFrame>{t("No requests yet.")}</EmptyFrame>} />
          )}
        </Loaded>
      </Block>
    </AdminPage>
  );
}

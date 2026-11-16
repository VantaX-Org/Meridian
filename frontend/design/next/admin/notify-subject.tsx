"use client";
/* Admin notify: Data subject requests. Native port of design/v2/admin/subjectrequests.tsx. */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { downloadSubjectExport, dryRunErasure, executeErasure, liftSuppression, searchSubject, subjectError, type SubjectErase, type SubjectLedgerRow, type SubjectResult, type SuppressionItem } from "@/lib/api/v2/subject-requests";
import { refreshAdmin, useSubjectRequests, useSuppressions } from "@/lib/v2/admin-queries";
import { relTime } from "@/lib/v2/format";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { Button, Chip, Code, DataTable, type Column } from "../kit";
import { Denied } from "../more/states";
import { Bad, NotifyBlock, NotifyLoaded, NotifyPage } from "./notify-kit";

const CONFIRM_WORD = "ERASE";
const MIN_REASON = 10;

/** What each table holds, so no code stands alone. The keys are the table names the API reports. */
const TABLE: Record<string, () => string> = {
  finding_records: () => t("Records that failed a rule, per run"),
  record_issues: () => t("Open and closed issues on a record"),
  work_records: () => t("Work items and their status per record"),
  record_hashes: () => t("Change-detection fingerprints per record"),
  remediation_items: () => t("Remediation tasks for a record"),
  rule_suppressions: () => t("Rules switched off for one record"),
  data_anomalies: () => t("Statistical anomalies on a record"),
  config_matches: () => t("Configuration matches on a record"),
  migration_gap_findings: () => t("Migration readiness gaps on a record"),
  record_fixes: () => t("Fixes proposed or applied to a record"),
  data_duplicates: () => t("Duplicate pairs found by the checks"),
  dedup_candidates: () => t("Duplicate candidates awaiting a decision"),
  match_scores: () => t("Match scores between two records"),
  record_relationships: () => t("Links from one record to another"),
  master_records: () => t("Golden records"),
  master_record_history: () => t("Every change made to a golden record"),
  golden_writeback_requests: () => t("Requests to write a golden record back to SAP"),
  mdm_pair_constraints: () => t("Always-match and never-match decisions on two records"),
  survivorship_decisions: () => t("Which source value won for a golden record"),
  cleaning_queue: () => t("Cleansing queue: values before and after"),
  cleaning_audit: () => t("Cleansing audit: values before and after"),
  change_requests: () => t("Change requests on this record: key, title and content"),
  change_request_field_changes: () => t("Old and new values in change requests"),
  mdm_merge_events: () => t("Merge events and the records merged"),
  migration_export_files: () => t("Record keys listed in migration export files"),
  migration_reconciliations: () => t("Reconciliation rows for this record in a migration run"),
  change_request_comments: () => t("Comments on this record's change requests"),
  change_request_attachments: () => t("Attachment links on this record's change requests"),
  writeback_run_records: () => t("Values sent to SAP for this record in a write-back run"),
  comments: () => t("Comments on this record or naming it"),
  watches: () => t("People watching this record"),
  notifications: () => t("Notifications that name this record"),
  undo_actions: () => t("Undo entries that would write this record's values back"),
  webhook_deliveries: () => t("Webhook messages that carried this record"),
  field_dependencies: () => t("Field dependency profiles that use this record as a sample"),
  learned_rule_proposals: () => t("Proposed rules that use this record as a sample"),
  exceptions: () => t("Exceptions that list this record as affected"),
  exception_comments: () => t("Comments on exceptions that name this record"),
  audit_log: () => t("Audit log entries that carry the exact key"),
  extracts: () => t("Rows in extract files of the object store"),
};
const SCRUBBED = new Set(["cleaning_queue", "cleaning_audit", "change_requests", "change_request_field_changes", "mdm_merge_events", "migration_export_files", "migration_reconciliations", "writeback_run_records", "webhook_deliveries", "field_dependencies", "learned_rule_proposals", "exceptions", "audit_log"]);

type Row = { table: string; rows: number };
const rowsOf = (r: SubjectResult): Row[] => [...Object.entries(r.rows_by_table).map(([table, rows]) => ({ table, rows })), { table: "extracts", rows: r.extracts.rows }];

const COLUMNS = (): Column<Row>[] => [
  { id: "table", label: t("Table"), cell: (r) => <Code code={r.table} text={TABLE[r.table]?.()} /> },
  { id: "rows", label: t("Rows"), align: "end", cell: (r) => r.rows, compare: (a, b) => a.rows - b.rows },
  { id: "how", label: t("On erasure"), cell: (r) => (r.table === "extracts" ? t("Rows removed, file rewritten") : SCRUBBED.has(r.table) ? t("Row kept, key and values cleared") : t("Row deleted")) },
];

function HeldTable({ rows, caption, empty }: { rows: Row[]; caption: string; empty: string }) {
  return <DataTable caption={caption} rows={rows} rowKey={(r) => r.table} rowLabel={(r) => r.table} columns={COLUMNS()} empty={{ heading: empty }} />;
}

const LEDGER_COLUMNS = (): Column<SubjectLedgerRow>[] => [
  { id: "when", label: t("When"), cell: (r) => relTime(r.created_at) },
  { id: "kind", label: t("Request"), cell: (r) => (r.kind === "access" ? t("Search or export") : r.dry_run ? t("Erasure dry run") : t("Erasure")) },
  { id: "rows", label: t("Rows"), align: "end", cell: (r) => Object.values(r.rows_by_table).reduce((a, b) => a + b, 0) + r.extract_rows },
  { id: "status", label: t("Status"), cell: (r) => <Chip tone={r.status === "done" ? "good" : "warn"}>{r.status === "done" ? t("Done") : t("Incomplete")}</Chip> },
  { id: "who", label: t("By"), cell: (r) => r.actor ?? "—" },
  { id: "reason", label: t("Reason"), cell: (r) => r.reason ?? "—" },
  { id: "id", label: t("Request id"), hidden: true, cell: (r) => <span className="nx-mono">{r.request_id}</span> },
];

const LIMITS: (() => string)[] = [
  () => t("Meridian does not delete from SAP. Erase the record there as well."),
  () => t("The suppression list drops an erased key from the extracts Meridian reads and stores. Some readers still see the old files: the change-detection baseline and the subject search read extract files directly. Erase the record in SAP as well, or the list is the only guard."),
  () => t("Backups of the database and the object store are out of reach. They age out on their own schedule."),
  () => t("Raw uploads, generated reports and archived files are not searched or changed."),
  () => t("Extract files are matched on the full record key only. A record without a key (row numbers) cannot be found in them."),
  () => t("Comments, attachments and workflow events on change requests, requests to create a record that have no key yet, sample key lists on learned rules and process variants, and the language model audit log are not changed. The audit log holds no record keys."),
  () => t("An open change request on this record stops the erasure. Finish or cancel it first."),
  () => t("A golden record under another key may still carry values merged from this one."),
  () => t("The search matches record keys, not names or other personal values: those are masked or dropped before findings are stored. A bare value matches the FIELD=value parts of keys in three tables only."),
];

const suppressionColumns = (texts: Record<string, string>, lift: (r: SuppressionItem) => void): Column<SuppressionItem>[] => [
  { id: "when", label: t("Erased"), cell: (r) => relTime(r.created_at) },
  { id: "fields", label: t("Key fields"), cell: (r) => r.key_fields.map((f, i) => <span key={f}>{i ? ", " : ""}<Code code={f} text={texts[f]} /></span>) },
  { id: "keys", label: t("Keys"), align: "end", cell: (r) => r.keys },
  { id: "dropped", label: t("Rows dropped"), align: "end", cell: (r) => r.dropped },
  { id: "last", label: t("Last dropped"), cell: (r) => (r.last_dropped_at ? relTime(r.last_dropped_at) : t("Never")) },
  { id: "status", label: t("Status"), cell: (r) => <Chip tone={r.active_keys > 0 ? "good" : "warn"}>{r.active_keys > 0 ? t("Active") : t("Lifted")}</Chip> },
  { id: "who", label: t("By"), cell: (r) => r.lifted_by ?? r.created_by ?? "—" },
  { id: "lift", label: t("Lift"), cell: (r) => (r.active_keys > 0 && r.request_id ? <Button size={32} variant="secondary" onClick={() => lift(r)}>{t("Lift")}</Button> : null) },
];

/** Admin, Data subject requests: find, export and erase what is held for one record key, dry run first. */
export function SubjectRequestsSection() {
  const can = useV2Session().can;
  const qc = useQueryClient();
  const allowed = can("manage_settings");
  const ledger = useSubjectRequests(allowed);
  const supp = useSuppressions(allowed);
  const [lifting, setLifting] = useState<string | null>(null);
  const [liftReason, setLiftReason] = useState("");
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
  if (!allowed) return <Denied what={t("Data subject requests")} />;

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
  const lift = () =>
    void run(async () => {
      if (!lifting) return;
      await liftSuppression(lifting, liftReason.trim());
      setLifting(null);
      setLiftReason("");
    }, t("The lift failed."));
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
    <NotifyPage lead={t("Find what is held for one record key, export it, or erase it. Erasure always starts with a dry run that lists exactly what would go. No language model sees any of it.")}>
      <NotifyBlock title={t("What erasure cannot do")} hint={t("Read this before you erase.")}>
        <ul className="nx-notify-list">
          {LIMITS.map((l, i) => (
            <li key={i}>{l()}</li>
          ))}
        </ul>
      </NotifyBlock>

      <NotifyBlock title={t("Find")} hint={t("Enter a full record key such as FIELD=value, or the value alone. The subject is never stored: the request list holds a keyed hash and counts.")}>
        <label className="nx-field">
          <span>{t("Record key or value")}</span>
          <input className="nx-input nx-mono" type="text" value={subject} maxLength={300} autoComplete="off" onChange={(e) => setSubject(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && subj && !busy) search(); }} />
        </label>
        <div className="nx-notify-actions">
          <Button variant="primary" disabled={busy || !subj} onClick={search}>{t("Search")}</Button>
        </div>
        {error ? <Bad>{error}</Bad> : null}
        {notice ? <p role="status">{notice}</p> : null}
        {found ? (
          <>
            <p role="status">
              {none
                ? t("Nothing is held for this key.")
                : t("{rows} rows across {tables} tables and {files} extract files, for {keys} record keys.", { rows: found.total_rows, tables: Object.keys(found.rows_by_table).length, files: found.extracts.files, keys: found.keys.length })}
            </p>
            {!found.extracts.complete ? <p className="nx-note">{t("Not every extract file could be read ({skipped} skipped, {errors} with errors), so the extract count may be low.", { skipped: found.extracts.skipped, errors: found.extracts.errors })}</p> : null}
            <HeldTable rows={rowsOf(found)} caption={t("Where the subject appears")} empty={t("Nothing is held for this key.")} />
            <div className="nx-notify-actions">
              <Button variant="secondary" disabled={busy || changed || none} onClick={exportIt}>{t("Export what is held")}</Button>
              <Button variant="secondary" disabled={busy || changed || none} onClick={dryRun}>{t("Dry run an erasure")}</Button>
            </div>
            {changed ? <p className="nx-sub">{t("The key changed. Search again before you export or erase.")}</p> : null}
          </>
        ) : null}
      </NotifyBlock>

      {dry ? (
        <NotifyBlock title={t("Erase: dry run")} hint={t("Nothing has been deleted. This is exactly what the erasure removes. The dry run is valid for 24 hours and for the records found now.")} testid="subject-dry">
          <HeldTable rows={rowsOf(dry)} caption={t("What would be erased")} empty={t("Nothing would be erased.")} />
          <div className="nx-notify-form">
            <label className="nx-field nx-notify-wide">
              <span>{t("Reason, at least {n} characters", { n: MIN_REASON })}</span>
              <textarea className="nx-input" rows={2} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
            </label>
            <label className="nx-field">
              <span>{t("Type {word} to confirm", { word: CONFIRM_WORD })}</span>
              <input className="nx-input nx-mono" type="text" value={word} autoComplete="off" onChange={(e) => setWord(e.target.value)} />
            </label>
          </div>
          <div className="nx-notify-actions">
            <Button variant="danger" disabled={busy || !ready} onClick={erase}>{t("Erase permanently")}</Button>
          </div>
        </NotifyBlock>
      ) : null}

      {done ? (
        <NotifyBlock title={t("Erased")}>
          <p role="status">
            <Chip tone={done.complete ? "good" : "warn"}>{done.complete ? t("Done") : t("Incomplete")}</Chip> {t("{rows} rows removed or cleared.", { rows: done.total_rows })}
          </p>
          {!done.complete ? <p className="nx-note">{t("Some extract files could not be rewritten. The database part is final. Run the search again to see what remains.")}</p> : null}
          <HeldTable rows={rowsOf(done)} caption={t("What was erased")} empty={t("Nothing was erased.")} />
        </NotifyBlock>
      ) : null}

      <NotifyBlock title={t("Suppression list")} hint={t("Erased keys that extraction drops before findings, work records or files. The list holds a keyed hash, never the key. Lifting needs a reason and is audited.")}>
        <NotifyLoaded q={supp} what={t("The suppression list")}>
          {(d) => (
            <>
              <p role="status">{t("{keys} active keys, {rows} rows dropped.", { keys: d.active_keys, rows: d.dropped_total })}</p>
              <DataTable
                caption={t("Suppression list")}
                rows={d.items}
                rowKey={(r) => r.request_id ?? r.created_at}
                rowLabel={(r) => r.key_fields.join(", ")}
                columns={suppressionColumns(d.field_texts, (r) => { setLifting(r.request_id); setLiftReason(""); })}
                empty={{ heading: t("No suppressions yet.") }}
              />
            </>
          )}
        </NotifyLoaded>
        {lifting ? (
          <>
            <label className="nx-field">
              <span>{t("Reason, at least {n} characters", { n: MIN_REASON })}</span>
              <textarea className="nx-input" rows={2} value={liftReason} maxLength={1000} onChange={(e) => setLiftReason(e.target.value)} />
            </label>
            <div className="nx-notify-actions">
              <Button variant="primary" disabled={busy || liftReason.trim().length < MIN_REASON} onClick={lift}>{t("Lift")}</Button>
              <Button variant="quiet" onClick={() => setLifting(null)}>{t("Cancel")}</Button>
            </div>
          </>
        ) : null}
      </NotifyBlock>

      <NotifyBlock title={t("Requests so far")} hint={t("Counts and a keyed hash only. The record key is never kept.")}>
        <NotifyLoaded q={ledger} what={t("The request list")}>
          {(rows) => <DataTable caption={t("Requests so far")} rows={rows} rowKey={(r) => r.request_id} rowLabel={(r) => r.request_id} columns={LEDGER_COLUMNS()} empty={{ heading: t("No requests yet.") }} />}
        </NotifyLoaded>
      </NotifyBlock>
    </NotifyPage>
  );
}

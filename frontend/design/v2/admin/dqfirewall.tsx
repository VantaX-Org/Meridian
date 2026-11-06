"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { validateRecords, type FirewallFailure, type FirewallVerdict } from "@/lib/api/v2/dq-firewall";
import { errorSentence } from "@/lib/api/v2/client";
import { useFirewallSummary, refreshAdmin } from "@/lib/v2/admin-queries";
import { relTime } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { Grid, type GridColumn } from "../Grid";
import { EmptyFrame, Mono } from "../parts";
import { DuplicateResults } from "../screens/EntryDuplicates";
import { AdminPage, Block, copyText, Fld, Kv, Loaded, NeedsPermission, Note, StatusWord, useCan } from "./kit";

type Row = FirewallFailure & { record: number };

const SEVERITY: Record<FirewallFailure["severity"], string> = {
  get critical() { return t("Critical"); },
  get high() { return t("High"); },
  get medium() { return t("Medium"); },
  get low() { return t("Low"); },
};
const DIMENSION: Record<string, string> = {
  get completeness() { return t("Completeness"); },
  get validity() { return t("Validity"); },
  get consistency() { return t("Consistency"); },
  get accuracy() { return t("Accuracy"); },
  get timeliness() { return t("Timeliness"); },
  get uniqueness() { return t("Uniqueness"); },
};

const COLUMNS: GridColumn<Row>[] = [
  { id: "record", get header() { return t("Record"); }, width: 80, cell: (r) => r.record + 1 },
  { id: "rule", get header() { return t("Rule"); }, width: 100, pin: true, locked: true, cell: (r) => <Mono>{r.rule_id}</Mono> },
  { id: "about", get header() { return t("What the rule requires"); }, width: 380, cell: (r) => r.description },
  { id: "field", get header() { return t("Field"); }, width: 130, cell: (r) => <Mono>{r.field}</Mono> },
  { id: "severity", get header() { return t("Severity"); }, width: 110, cell: (r) => <StatusWord tone={r.severity === "critical" ? "no-go" : r.severity === "high" ? "at-risk" : "neutral"}>{SEVERITY[r.severity]}</StatusWord> },
  { id: "dimension", get header() { return t("Dimension"); }, width: 130, cell: (r) => DIMENSION[r.dimension] ?? r.dimension },
  { id: "reason", get header() { return t("Why it failed"); }, width: 260, cell: (r) => r.reason },
];

const SAMPLE = JSON.stringify(
  [
    { "MARA.MATNR": "FIREWALL-TEST-1", "MARA.MTART": "ROH", "MARA.MEINS": "KG" },
    { "MARA.MATNR": "FIREWALL-TEST-2", "MARA.MTART": "", "MARA.MEINS": "KG" },
  ],
  null,
  2,
);

// i18n-ignore: a shell command, not prose
const CURL_HEAD = ["curl -X POST https://<your-meridian-host>/api/v1/dq-firewall/validate", '  -H "Authorization: Bearer <API key>"', '  -H "Content-Type: application/json"'].join(" \\\n");
const curl = (obj: string): string =>
  CURL_HEAD + " \\\n  -d '" + JSON.stringify({ module: obj, records: [{ "MARA.MATNR": "FIREWALL-TEST-2", "MARA.MTART": "" }] }) + "'";

/** Admin › Data quality firewall: the endpoint, a sample call, a try-it box and how often it has been called. */
export function DqFirewallSection() {
  const can = useCan();
  const qc = useQueryClient();
  const allowed = can("manage_settings") || can("manage_users");
  const q = useFirewallSummary(allowed);
  const [obj, setObj] = useState("material_master");
  const [text, setText] = useState(SAMPLE);
  const [duplicates, setDuplicates] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FirewallVerdict | null>(null);
  if (!allowed) return <AdminPage title={t("Data quality firewall")}><NeedsPermission what={t("The data quality firewall")} permission="manage_settings" /></AdminPage>;

  const run = async () => {
    setError(null);
    setResult(null);
    let records: Record<string, string>[];
    try {
      const parsed: unknown = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("array");
      records = parsed as Record<string, string>[];
    } catch {
      setError(t("The records must be a JSON list of objects, each with TABLE.FIELD values."));
      return;
    }
    setPending(true);
    try {
      setResult(await validateRecords(obj, records, { duplicates }));
      void refreshAdmin(qc, "dqfirewall");
    } catch (e) {
      setError(errorSentence(e, t("The records could not be checked.")));
    } finally {
      setPending(false);
    }
  };
  const rows: Row[] = result ? result.records.flatMap((r) => r.failures.map((f) => ({ ...f, record: r.index }))) : [];
  const blocked = result ? result.records.filter((r) => r.verdict === "block").length : 0;

  return (
    <AdminPage title={t("Data quality firewall")} lead={t("An SAP BAdI, middleware or a pipeline posts up to {max} candidate records and gets back, at once, the enabled rules each one fails. A record with a failing critical rule is blocked. Nothing is stored except an audit entry, and no language model sees the records.", { max: 100 })}>
      <Block title={t("Endpoint")} hint={t("Authenticate with an API key whose role may change master data.")}>
        <Loaded q={q} what={t("The firewall summary")}>
          {(s) => (
            <>
              <Kv
                rows={[
                  [t("Endpoint"), <Mono key="e">POST /api/v1/dq-firewall/validate</Mono>],
                  [t("Records per call"), s.max_records],
                  [t("Blocks on severity"), SEVERITY[s.block_severity as FirewallFailure["severity"]] ?? s.block_severity],
                  [t("Calls in the last 24 hours"), s.calls_24h],
                  [t("Calls in the last 7 days"), s.calls_7d],
                  [t("Last call"), s.last_call_at ? relTime(s.last_call_at) : t("Never")],
                ]}
              />
              <pre className="m2-code" aria-label={t("Sample call")}>{curl(obj)}</pre>
              <div className="m2-adm-acts">
                <button type="button" className="m2-btn" onClick={() => void copyText(curl(obj))}>{t("Copy the sample call")}</button>
              </div>
            </>
          )}
        </Loaded>
      </Block>
      <Block title={t("Try it")} hint={t("Runs the same check as the endpoint on the records below. Fixture mode judges Material master only.")}>
        <div className="m2-fgrid">
          <Fld label={t("Object")}>
            <select value={obj} onChange={(e) => setObj(e.target.value)}>
              {(q.data?.modules ?? ["material_master"]).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </Fld>
          <Fld label={t("Records, as JSON")} wide mono>
            <textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          </Fld>
          <Fld label={t("Look for duplicates among existing records")}>
            <input type="checkbox" checked={duplicates} onChange={(e) => setDuplicates(e.target.checked)} />
          </Fld>
        </div>
        <div className="m2-adm-acts">
          <button type="button" className="m2-btn m2-next" disabled={pending} onClick={() => void run()}>{t("Check records")}</button>
        </div>
        {error ? <Note tone="bad">{error}</Note> : null}
        {result ? (
          <>
            <p role="status">
              <StatusWord tone={result.verdict === "block" ? "no-go" : "go"}>{result.verdict === "block" ? t("Blocked") : t("Passed")}</StatusWord>{" "}
              {t("{blocked} of {total} records blocked, {rules} rules run.", { blocked, total: result.records.length, rules: result.rules_run })}
            </p>
            <Grid<Row>
              id="admin-dqfirewall"
              ariaLabel={t("Failing rules")}
              columns={COLUMNS}
              rows={rows}
              rowId={(r) => `${r.record}:${r.rule_id}`}
              emptyFrame={<EmptyFrame>{t("Every record passed every enabled rule.")}</EmptyFrame>}
            />
            <DuplicateResults res={result} />
          </>
        ) : null}
      </Block>
    </AdminPage>
  );
}

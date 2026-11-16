"use client";
/* Admin notify: Data quality firewall. Native port of design/v2/admin/dqfirewall.tsx and the v2 EntryDuplicates DuplicateResults. */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { validateRecords, type DuplicateNotSearched, type FirewallFailure, type FirewallVerdict, type FuzzyNotRun, type NearNotRun } from "@/lib/api/v2/dq-firewall";
import { errorSentence } from "@/lib/api/v2/client";
import { useFirewallSummary, refreshAdmin } from "@/lib/v2/admin-queries";
import { writeClipboard } from "@/lib/browser";
import { relTime } from "@/lib/v2/format";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { Button, Chip, Code, DataTable, type Column } from "../kit";
import { Denied } from "../more/states";
import { Bad, Kv, NotifyBlock, NotifyLoaded, NotifyPage } from "./notify-kit";

type Row = FirewallFailure & { record: number };

const SEVERITY: Record<FirewallFailure["severity"], () => string> = {
  critical: () => t("Critical"),
  high: () => t("High"),
  medium: () => t("Medium"),
  low: () => t("Low"),
};
const DIMENSION: Record<string, () => string> = {
  completeness: () => t("Completeness"),
  validity: () => t("Validity"),
  consistency: () => t("Consistency"),
  accuracy: () => t("Accuracy"),
  timeliness: () => t("Timeliness"),
  uniqueness: () => t("Uniqueness"),
};

const COLUMNS = (): Column<Row>[] => [
  { id: "record", label: t("Record"), align: "end", cell: (r) => r.record + 1, compare: (a, b) => a.record - b.record },
  { id: "rule", label: t("Rule"), cell: (r) => <Code code={r.rule_id} text={r.description} /> },
  { id: "field", label: t("Field"), cell: (r) => <Code code={r.field} text={r.field_description && r.field_description !== r.field ? r.field_description : undefined} /> },
  { id: "severity", label: t("Severity"), cell: (r) => <Chip tone={r.severity === "critical" ? "bad" : r.severity === "high" ? "warn" : "neutral"}>{SEVERITY[r.severity]()}</Chip> },
  { id: "dimension", label: t("Dimension"), cell: (r) => DIMENSION[r.dimension]?.() ?? r.dimension },
  { id: "reason", label: t("Why it failed"), cell: (r) => r.reason },
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

/** Admin, Data quality firewall: the endpoint, a sample call, a try-it box and how often it has been called. */
export function DqFirewallSection() {
  const can = useV2Session().can;
  const qc = useQueryClient();
  const allowed = can("manage_settings") || can("manage_users");
  const q = useFirewallSummary(allowed);
  const [obj, setObj] = useState("material_master");
  const [text, setText] = useState(SAMPLE);
  const [duplicates, setDuplicates] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FirewallVerdict | null>(null);
  const [copied, setCopied] = useState(false);
  if (!allowed) return <Denied what={t("The data quality firewall")} />;

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
    <NotifyPage lead={t("An SAP BAdI, middleware or a pipeline posts up to {max} candidate records and gets back, at once, the enabled rules each one fails. A record with a failing critical rule is blocked. Nothing is stored except an audit entry, and no language model sees the records.", { max: 100 })}>
      <NotifyBlock title={t("Endpoint")} hint={t("Authenticate with an API key whose role may change master data.")}>
        <NotifyLoaded q={q} what={t("The firewall summary")}>
          {(s) => (
            <>
              <Kv
                rows={[
                  [t("Endpoint"), <code key="e" className="nx-mono">POST /api/v1/dq-firewall/validate</code>],
                  [t("Records per call"), s.max_records],
                  [t("Blocks on severity"), SEVERITY[s.block_severity as FirewallFailure["severity"]]?.() ?? s.block_severity],
                  [t("Calls in the last 24 hours"), s.calls_24h],
                  [t("Calls in the last 7 days"), s.calls_7d],
                  [t("Last call"), s.last_call_at ? relTime(s.last_call_at) : t("Never")],
                ]}
              />
              <pre className="nx-notify-pre" aria-label={t("Sample call")}>{curl(obj)}</pre>
              <div className="nx-notify-actions">
                <Button variant="secondary" onClick={() => void writeClipboard(curl(obj)).then(setCopied)}>{copied ? t("Copied") : t("Copy the sample call")}</Button>
              </div>
            </>
          )}
        </NotifyLoaded>
      </NotifyBlock>
      <NotifyBlock title={t("Try it")} hint={t("Runs the same check as the endpoint on the records below. Fixture mode judges Material master only.")}>
        <div className="nx-notify-form">
          <label className="nx-field">
            <span>{t("Object")}</span>
            <select className="nx-input" value={obj} onChange={(e) => setObj(e.target.value)}>
              {(q.data?.modules ?? ["material_master"]).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="nx-field nx-notify-wide">
            <span>{t("Records, as JSON")}</span>
            <textarea className="nx-input nx-mono" rows={9} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          </label>
          <label className="nx-row">
            <input type="checkbox" checked={duplicates} onChange={(e) => setDuplicates(e.target.checked)} />
            <span>{t("Look for duplicates among existing records")}</span>
          </label>
        </div>
        <div className="nx-notify-actions">
          <Button variant="primary" loading={pending} disabled={pending} onClick={() => void run()}>{t("Check records")}</Button>
        </div>
        {error ? <Bad>{error}</Bad> : null}
        {result ? (
          <>
            <p role="status">
              <Chip tone={result.verdict === "block" ? "bad" : "good"}>{result.verdict === "block" ? t("Blocked") : t("Passed")}</Chip>{" "}
              {t("{blocked} of {total} records blocked, {rules} rules run.", { blocked, total: result.records.length, rules: result.rules_run })}
            </p>
            <DataTable
              caption={t("Failing rules")}
              rows={rows}
              rowKey={(r) => `${r.record}:${r.rule_id}`}
              rowLabel={(r) => r.rule_id}
              columns={COLUMNS()}
              empty={{ heading: t("Every record passed every enabled rule.") }}
            />
            <DuplicateResults res={result} />
          </>
        ) : null}
      </NotifyBlock>
    </NotifyPage>
  );
}

/* Duplicate search of the entry gate. Shows the existing record's key, the score and the fields that matched, never the other
 * record's values (the API does not send them). "Not searched" is said with its reason; it is never shown as "no duplicates". */
const FIELD: Record<string, () => string> = {
  "MARA.MFRPN": () => t("Manufacturer part number"),
  "MARA.BISMT": () => t("Old material number"),
  "MAKT.MAKTX": () => t("Material description"),
  "KNA1.NAME1": () => t("Customer name"),
  "KNA1.STCEG": () => t("VAT registration number"),
  "KNA1.STCD1": () => t("Tax number 1"),
  "KNA1.STCD2": () => t("Tax number 2"),
  "BUT000.NAME_ORG1": () => t("Organisation name"),
};
const COMPARATOR: Record<string, () => string> = {
  part_number: () => t("Part number, ignoring punctuation"),
  desc_tokens: () => t("Description words"),
  name_legal: () => t("Legal name words"),
  tax_exact: () => t("Tax number, exact"),
  address_tokens: () => t("Address words"),
  phone_e164: () => t("Phone number"),
  bank_exact: () => t("Bank account, exact"),
  code_exact: () => t("Code, exact"),
  email: () => t("Email address"),
  national_id: () => t("National identifier, exact"),
  date_exact: () => t("Date"),
  person_name: () => t("Person name words"),
};
const BAND: Record<string, () => string> = {
  auto_merge: () => t("At the auto-merge threshold"),
  steward_review: () => t("Below it, for a steward to review"),
};
const REASON: Record<DuplicateNotSearched, () => string> = {
  module_not_supported: () => t("Duplicate search does not cover this object, so nothing was searched."),
  no_match_rules: () => t("No match rule is active for this object, so nothing was searched."),
  no_population: () => t("There are no existing records of this object to search, so nothing was searched."),
  no_block_field_in_population: () => t("The existing records of this object do not carry the fields the search looks up, so nothing was searched."),
};
const FUZZY: Record<FuzzyNotRun, () => string> = {
  extension_missing: () => t("the typo-tolerant search is not installed on this database"),
  index_missing: () => t("the typo-tolerant search index is not built on this database"),
  key_too_short: () => t("the name is too short to compare for typos"),
  no_free_text_value: () => t("the record has no name or description to compare for typos"),
  not_searched: () => t("the record was not searched"),
};
const NEAR: Partial<Record<NearNotRun, () => string>> = {
  index_missing: () => t("the near-value search index is not built on this database"),
  key_length: () => t("its tax or part number is too short or too long to compare"),
};
const FOUND_BY: Record<string, () => string> = {
  exact: () => t("Same value"),
  similar: () => t("Similar value, typo tolerated"),
  near: () => t("Near value, one character off"),
};
const pct = (n: number) => `${Math.round(n * 100)}%`;

type DupRow = { record: number; m: NonNullable<FirewallVerdict["records"][number]["duplicates"]>["matches"][number] };

const DUP_COLUMNS = (): Column<DupRow>[] => [
  { id: "record", label: t("Record"), align: "end", cell: (r) => r.record + 1 },
  { id: "key", label: t("Existing record"), cell: (r) => <Code code={r.m.key} /> },
  { id: "score", label: t("Score"), align: "end", cell: (r) => pct(r.m.score), compare: (a, b) => a.m.score - b.m.score },
  { id: "band", label: t("Where it falls"), cell: (r) => BAND[r.m.band]?.() ?? r.m.band },
  { id: "found", label: t("Found by"), cell: (r) => FOUND_BY[r.m.found_by]?.() ?? r.m.found_by },
  {
    id: "fields",
    label: t("Matched on"),
    cell: ({ m }) => (
      <>
        {m.found_by === "near" && m.found_field ? (
          <div data-testid="entry-dup-near-field">
            <Code code={m.found_field} text={FIELD[m.found_field]?.()} />: {t("one character different, or two neighbouring characters swapped")}
          </div>
        ) : null}
        {m.fields.map((f) => (
          <div key={f.field}>
            <Code code={f.field} text={FIELD[f.field]?.()} />: {COMPARATOR[f.comparator]?.() ?? f.comparator}, {t("{n} similar", { n: pct(f.similarity) })}
            {f.met ? "" : ` (${t("below its own threshold")})`}
          </div>
        ))}
      </>
    ),
  },
];

export function DuplicateResults({ res }: { res: FirewallVerdict }) {
  const s = res.duplicate_search;
  if (!s) return null;
  if (!s.searched) {
    const why = s.reason ? (REASON[s.reason]?.() ?? s.reason) : t("Nothing was searched.");
    return <p role="status" data-testid="entry-dup-not-searched">{t("Duplicate search")}: {why}</p>;
  }
  const rows: DupRow[] = res.records.flatMap((r) => (r.duplicates?.matches ?? []).map((m) => ({ record: r.index, m })));
  const warned = res.records.filter((r) => r.duplicates?.verdict === "warn").length;
  const cut = res.records.filter((r) => r.duplicates?.truncated);
  const skipped = res.records.filter((r) => r.duplicates && !r.duplicates.searched);
  const noFuzzy = res.records.filter((r) => r.duplicates?.searched && !r.duplicates.fuzzy.ran);
  const noNear = res.records.filter((r) => r.duplicates?.searched && !r.duplicates.near.ran && NEAR[r.duplicates.near.reason ?? "not_searched"]);
  return (
    <div data-testid="entry-dup" className="nx-notify">
      <p role="status" data-testid="entry-dup-result">
        {t("Duplicate search")}:{" "}
        {rows.length === 0
          ? skipped.length === res.records.length
            ? t("Nothing was searched.")
            : t("No likely duplicate found among the existing records.")
          : t("{warned} of {total} records warned, scored against the auto-merge threshold of {threshold}. A duplicate warns and never blocks.", { warned, total: res.records.length, threshold: pct(s.thresholds.auto_merge ?? 0.95) })}
      </p>
      {skipped.length ? (
        <p role="note" className="nx-note" data-testid="entry-dup-skipped">
          {t("Record {records} was not searched: it has no value the search can look up. That is not a clean result.", { records: skipped.map((r) => r.index + 1).join(", ") })}
        </p>
      ) : null}
      {noFuzzy.map((r) => (
        <p key={r.index} role="note" className="nx-note" data-testid="entry-dup-no-fuzzy">
          {t("Record {record}: only identical values were searched, because {why}. A typo in its name would not be found.", { record: r.index + 1, why: FUZZY[r.duplicates!.fuzzy.reason ?? "not_searched"]?.() ?? r.duplicates!.fuzzy.reason ?? "" })}
        </p>
      ))}
      {noNear.map((r) => (
        <p key={r.index} role="note" className="nx-note" data-testid="entry-dup-no-near">
          {t("Record {record}: a tax or part number one character off was not searched, because {why}.", { record: r.index + 1, why: NEAR[r.duplicates!.near.reason ?? "not_searched"]?.() ?? "" })}
        </p>
      ))}
      {cut.length ? (
        <p role="note" className="nx-note" data-testid="entry-dup-truncated">
          {t("Only the first {cap} candidates were scored for record {records}, so a further duplicate may exist.", { cap: s.cap, records: cut.map((r) => r.index + 1).join(", ") })}
        </p>
      ) : null}
      {rows.length ? <DataTable caption={t("Likely duplicates")} rows={rows} rowKey={(r) => `${r.record}:${r.m.key}`} rowLabel={(r) => r.m.key} columns={DUP_COLUMNS()} /> : null}
    </div>
  );
}

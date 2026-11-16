"use client";

import type { DdicEvidence, DuplicateMatch, DuplicateNotSearched, FirewallVerdict, FuzzyNotRun, NearNotRun } from "@/lib/api/v2/dq-firewall";
import { t } from "@/lib/v2/i18n";
import { Code, DataTable, type Column } from "../../kit";
import { TableSave } from "./TableSave";

/**
 * Entry gate evidence, native: what the ABAP Dictionary says about a value (api/services/ddic_value_check.py) and the
 * likely duplicates the gate found among existing records. A duplicate warns and never blocks.
 */

function sourceWord(e: DdicEvidence): string {
  if (!e.check_table) return t("no check table");
  if (e.source === "live") return t("check table {table}, read from the system", { table: e.check_table });
  if (e.source === "baseline") return t("check table {table}, SAP-standard values", { table: e.check_table });
  return t("check table {table}, not read", { table: e.check_table });
}

export function DdicCard({ e }: { e?: DdicEvidence | null }) {
  if (!e) return <span className="nx-sub" title={t("The SAP dictionary does not know this field.")}>-</span>;
  const size = e.type ? `${e.type} ${e.length ?? ""}${e.decimals ? `,${e.decimals}` : ""}`.trim() : null;
  return (
    <div className="nx-cell-stack" data-testid="ddic-card">
      <Code code={e.field} text={e.field_text ?? undefined} />
      <span className="nx-sub">
        {[e.data_element && t("data element {de}", { de: e.data_element }), e.domain && t("domain {d}", { d: e.domain }), size, sourceWord(e)].filter(Boolean).join(", ")}
      </span>
      {e.reasons.length ? <ul data-testid="ddic-reasons">{e.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
      {e.nearest.length ? (
        <span data-testid="ddic-nearest">
          {t("Did you mean")} {e.nearest.map((n) => <Code key={n.code} code={n.code} text={n.text ?? undefined} />)}
        </span>
      ) : null}
    </div>
  );
}

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

type Row = { record: number; m: DuplicateMatch };

export function DuplicateResults({ res }: { res: FirewallVerdict }) {
  const s = res.duplicate_search;
  if (!s) return null;
  if (!s.searched) {
    const why = s.reason ? (REASON[s.reason]?.() ?? s.reason) : t("Nothing was searched.");
    return <p role="note" data-testid="entry-dup-not-searched">{t("Duplicate search")}: {why}</p>;
  }
  const rows: Row[] = res.records.flatMap((r) => (r.duplicates?.matches ?? []).map((m) => ({ record: r.index, m })));
  const warned = res.records.filter((r) => r.duplicates?.verdict === "warn").length;
  const cut = res.records.filter((r) => r.duplicates?.truncated);
  const skipped = res.records.filter((r) => r.duplicates && !r.duplicates.searched);
  const noFuzzy = res.records.filter((r) => r.duplicates?.searched && !r.duplicates.fuzzy.ran);
  const noNear = res.records.filter((r) => r.duplicates?.searched && !r.duplicates.near.ran && NEAR[r.duplicates.near.reason ?? "not_searched"]);
  const cols: Column<Row>[] = [
    { id: "record", label: t("Record"), align: "end", cell: (x) => x.record + 1 },
    { id: "existing", label: t("Existing record"), cell: (x) => <code className="nx-code">{x.m.key}</code> },
    { id: "score", label: t("Score"), align: "end", compare: (a, b) => a.m.score - b.m.score, cell: (x) => pct(x.m.score) },
    { id: "band", label: t("Where it falls"), cell: (x) => BAND[x.m.band]?.() ?? x.m.band },
    { id: "found", label: t("Found by"), cell: (x) => FOUND_BY[x.m.found_by]?.() ?? x.m.found_by },
    {
      id: "matched", label: t("Matched on"), cell: ({ m }) => (
        <span className="nx-cell-stack">
          {m.found_by === "near" && m.found_field ? (
            <span data-testid="entry-dup-near-field">
              <Code code={m.found_field} text={FIELD[m.found_field]?.()} />: {t("one character different, or two neighbouring characters swapped")}
            </span>
          ) : null}
          {m.fields.map((f) => (
            <span key={f.field}>
              <Code code={f.field} text={FIELD[f.field]?.()} />: {COMPARATOR[f.comparator]?.() ?? f.comparator}, {t("{n} similar", { n: pct(f.similarity) })}
              {f.met ? "" : ` (${t("below its own threshold")})`}
            </span>
          ))}
        </span>
      ),
    },
  ];
  return (
    <div data-testid="entry-dup">
      <p role="status" data-testid="entry-dup-result">
        {t("Duplicate search")}:{" "}
        {rows.length === 0
          ? (skipped.length === res.records.length ? t("Nothing was searched.") : t("No likely duplicate found among the existing records."))
          : t("{warned} of {total} records warned, scored against the auto-merge threshold of {threshold}. A duplicate warns and never blocks.", { warned, total: res.records.length, threshold: pct(s.thresholds.auto_merge ?? 0.95) })}
      </p>
      {skipped.length ? (
        <p role="note" data-testid="entry-dup-skipped">
          {t("Record {records} was not searched: it has no value the search can look up. That is not a clean result.", { records: skipped.map((r) => r.index + 1).join(", ") })}
        </p>
      ) : null}
      {noFuzzy.map((r) => (
        <p key={r.index} role="note" data-testid="entry-dup-no-fuzzy">
          {t("Record {record}: only identical values were searched, because {why}. A typo in its name would not be found.", { record: r.index + 1, why: FUZZY[r.duplicates!.fuzzy.reason ?? "not_searched"]?.() ?? r.duplicates!.fuzzy.reason ?? "" })}
        </p>
      ))}
      {noNear.map((r) => (
        <p key={r.index} role="note" data-testid="entry-dup-no-near">
          {t("Record {record}: a tax or part number one character off was not searched, because {why}.", { record: r.index + 1, why: NEAR[r.duplicates!.near.reason ?? "not_searched"]?.() ?? "" })}
        </p>
      ))}
      {cut.length ? (
        <p role="note" data-testid="entry-dup-truncated">
          {t("Only the first {cap} candidates were scored for record {records}, so a further duplicate may exist.", { cap: s.cap, records: cut.map((r) => r.index + 1).join(", ") })}
        </p>
      ) : null}
      {rows.length ? (
        <TableSave title={t("Likely duplicates")}>
          <DataTable rows={rows} columns={cols} rowKey={(x) => `${x.record}:${x.m.key}`} rowLabel={(x) => x.m.key} caption={t("Likely duplicates")} />
        </TableSave>
      ) : null}
    </div>
  );
}

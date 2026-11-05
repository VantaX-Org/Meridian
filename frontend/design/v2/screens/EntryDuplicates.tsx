"use client";

import type { DuplicateNotSearched, FirewallVerdict, FuzzyNotRun } from "@/lib/api/v2/dq-firewall";
import { t } from "@/lib/v2/i18n";
import { Mono } from "../parts";
import { ScrollFrame } from "./object/ScrollFrame";

/**
 * The duplicate search of the entry gate: which existing records a candidate looks like. Shows the existing record's
 * key, the score, the fields that matched and how, never the other record's values (the API does not send them).
 * "Not searched" is said with its reason; it is never shown as "no duplicates".
 */

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
const FOUND_BY: Record<string, () => string> = {
  exact: () => t("Same value"),
  similar: () => t("Similar value, typo tolerated"),
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function DuplicateResults({ res }: { res: FirewallVerdict }) {
  const s = res.duplicate_search;
  if (!s) return null;
  if (!s.searched) {
    const why = s.reason ? (REASON[s.reason]?.() ?? s.reason) : t("Nothing was searched.");
    return <p role="status" data-testid="entry-dup-not-searched">{t("Duplicate search")}: {why}</p>;
  }
  const rows = res.records.flatMap((r) => (r.duplicates?.matches ?? []).map((m) => ({ record: r.index, m })));
  const warned = res.records.filter((r) => r.duplicates?.verdict === "warn").length;
  const cut = res.records.filter((r) => r.duplicates?.truncated);
  const skipped = res.records.filter((r) => r.duplicates && !r.duplicates.searched);
  const noFuzzy = res.records.filter((r) => r.duplicates?.searched && !r.duplicates.fuzzy.ran);
  return (
    <div data-testid="entry-dup">
      <p role="status" data-testid="entry-dup-result">
        {t("Duplicate search")}:{" "}
        {rows.length === 0
          ? (skipped.length === res.records.length
            ? t("Nothing was searched.")
            : t("No likely duplicate found among the existing records."))
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
      {cut.length ? (
        <p role="note" data-testid="entry-dup-truncated">
          {t("Only the first {cap} candidates were scored for record {records}, so a further duplicate may exist.", { cap: s.cap, records: cut.map((r) => r.index + 1).join(", ") })}
        </p>
      ) : null}
      {rows.length ? (
        <ScrollFrame label={t("Likely duplicates table, scrollable")}>
          <table className="m2-tbl m2-cards">
            <thead>
              <tr>
                <th scope="col">{t("Record")}</th>
                <th scope="col">{t("Existing record")}</th>
                <th scope="col">{t("Score")}</th>
                <th scope="col">{t("Where it falls")}</th>
                <th scope="col">{t("Found by")}</th>
                <th scope="col">{t("Matched on")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ record, m }) => (
                <tr key={`${record}:${m.key}`}>
                  <td data-label={t("Record")} className="m2-num">{record + 1}</td>
                  <th scope="row" className="m2-card-lead"><Mono>{m.key}</Mono></th>
                  <td data-label={t("Score")} className="m2-num">{pct(m.score)}</td>
                  <td data-label={t("Where it falls")}>{BAND[m.band]?.() ?? m.band}</td>
                  <td data-label={t("Found by")}>{FOUND_BY[m.found_by]?.() ?? m.found_by}</td>
                  <td data-label={t("Matched on")}>
                    {m.fields.map((f) => (
                      <div key={f.field}>
                        <Mono>{f.field}</Mono> {FIELD[f.field]?.() ?? ""}: {COMPARATOR[f.comparator]?.() ?? f.comparator}, {t("{n} similar", { n: pct(f.similarity) })}
                        {f.met ? "" : ` (${t("below its own threshold")})`}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      ) : null}
    </div>
  );
}

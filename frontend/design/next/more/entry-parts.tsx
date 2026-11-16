"use client";

import type { DdicEvidence, DuplicateNotSearched, FirewallVerdict, FuzzyNotRun, NearNotRun } from "@/lib/api/v2/dq-firewall";
import type { RequestObject, RequestStatus } from "@/lib/api/v2/requests";
import { usePermissions } from "@/lib/permissions";
import { requestTargetFor } from "@/lib/rbac";
import { describeField } from "@/lib/v2/sap-fields";
import { t } from "@/lib/v2/i18n";
import { DASH, int } from "@/lib/v2/score";
import { Button, Code, DataTable } from "../kit";

/**
 * Shared parts of the entry gate: request words, the SAP dictionary card, the duplicate search and the permission
 * note. Native copies of the v2 parts with the same words.
 */

export function Dash({ why }: { why?: string }) {
  return <span title={why}>{DASH}</span>;
}

export function statusWord(s: RequestStatus, releasedAt?: string | null): string {
  if (s === "approved" && releasedAt) return t("Released to the SAP save");
  const words: Record<RequestStatus, string> = {
    draft: t("Draft"),
    submitted: t("Submitted"),
    in_approval: t("In approval"),
    approved: t("Approved"),
    rejected: t("Rejected"),
    creating: t("Creating in SAP"),
    created: t("Created in SAP"),
    failed: t("Failed in SAP"),
    cancelled: t("Cancelled"),
  };
  return words[s] ?? s;
}

export function objectWord(o: RequestObject): string {
  const words: Record<RequestObject, string> = { material: t("Material"), customer: t("Customer"), vendor: t("Vendor"), business_partner: t("Business partner") };
  return words[o] ?? o;
}

/** Hours as a short span: under two days in hours, else in days. */
export const ageWord = (h: number): string => (h < 48 ? t("{n} h", { n: int(Math.round(h)) }) : t("{n} d", { n: int(Math.round(h / 24)) }));

/** Says which permission an action needs and offers to ask for it. */
export function NeedsPermission({ what, permission }: { what: string; permission: string }) {
  const { requestAccess } = usePermissions();
  return (
    <p className="nx-note" data-testid="needs-permission">
      {t("{what} needs the {replace} permission. Ask an administrator to grant it.", { what, replace: permission.replace(/_/g, " ") })}{" "}
      <Button variant="secondary" size={32} data-testid="request-access" onClick={() => requestAccess(requestTargetFor({ resource: null, action: permission }))}>
        {t("Request access")}
      </Button>
    </p>
  );
}

export function FieldCode({ field }: { field: string }) {
  return <Code code={field} text={describeField(field) ?? undefined} />;
}

function sourceWord(e: DdicEvidence): string {
  if (!e.check_table) return t("no check table");
  if (e.source === "live") return t("check table {table}, read from the system", { table: e.check_table });
  if (e.source === "baseline") return t("check table {table}, SAP-standard values", { table: e.check_table });
  return t("check table {table}, not read", { table: e.check_table });
}

/** What the SAP dictionary says about a failing field. */
export function DdicCard({ evidence }: { evidence: DdicEvidence | null | undefined }) {
  if (!evidence) return <Dash why={t("The SAP dictionary does not know this field.")} />;
  const e = evidence;
  const size = e.type ? `${e.type} ${e.length ?? ""}${e.decimals ? `,${e.decimals}` : ""}`.trim() : null;
  const meta = [e.data_element ? t("data element {de}", { de: e.data_element }) : null, e.domain ? t("domain {d}", { d: e.domain }) : null, size, sourceWord(e)].filter(Boolean).join(", ");
  return (
    <div data-testid="ddic-card">
      <Code code={e.field} text={e.field_text ?? undefined} /> <span>{meta}</span>
      {e.reasons?.length ? (
        <ul data-testid="ddic-reasons">
          {e.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      ) : null}
      {e.nearest?.length ? (
        <div data-testid="ddic-nearest">
          {t("Did you mean")}{" "}
          {e.nearest.map((n) => <Code key={n.code} code={n.code} text={n.text ?? undefined} />)}
        </div>
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

const fieldCode = (f: string) => <Code code={f} text={FIELD[f]?.() ?? describeField(f) ?? undefined} />;

/** The duplicate search of the entry gate. "Not searched" is said with its reason, never shown as "no duplicates". */
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
  const noNear = res.records.filter((r) => r.duplicates?.searched && !r.duplicates.near.ran && NEAR[r.duplicates.near.reason ?? "not_searched"]);
  return (
    <div className="nx-body" data-testid="entry-dup">
      <p role="status" data-testid="entry-dup-result">
        {t("Duplicate search")}:{" "}
        {rows.length === 0
          ? (skipped.length === res.records.length ? t("Nothing was searched.") : t("No likely duplicate found among the existing records."))
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
      {rows.length ? (
        <DataTable
          caption={t("Likely duplicates table, scrollable")}
          rows={rows}
          rowKey={(r) => `${r.record}:${r.m.key}`}
          rowLabel={(r) => r.m.key}
          columns={[
            { id: "record", label: t("Record"), align: "end", cell: (r) => int(r.record + 1) },
            { id: "key", label: t("Existing record"), cell: (r) => <Code code={r.m.key} /> },
            { id: "score", label: t("Score"), align: "end", cell: (r) => pct(r.m.score) },
            { id: "band", label: t("Where it falls"), cell: (r) => BAND[r.m.band]?.() ?? r.m.band },
            { id: "found", label: t("Found by"), cell: (r) => FOUND_BY[r.m.found_by]?.() ?? r.m.found_by },
            {
              id: "fields",
              label: t("Matched on"),
              cell: ({ m }) => (
                <>
                  {m.found_by === "near" && m.found_field ? (
                    <div data-testid="entry-dup-near-field">
                      {fieldCode(m.found_field)}: {t("one character different, or two neighbouring characters swapped")}
                    </div>
                  ) : null}
                  {m.fields.map((f) => (
                    <div key={f.field}>
                      {fieldCode(f.field)}: {COMPARATOR[f.comparator]?.() ?? f.comparator}, {t("{n} similar", { n: pct(f.similarity) })}
                      {f.met ? "" : ` (${t("below its own threshold")})`}
                    </div>
                  ))}
                </>
              ),
            },
          ]}
        />
      ) : null}
    </div>
  );
}

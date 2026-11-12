"use client";

import type { DdicEvidence as Evidence } from "@/lib/api/v2/dq-firewall";
import { t } from "@/lib/v2/i18n";
import { VerdictMark } from "../marks";
import { Dash, Mono } from "../parts";

/**
 * What the ABAP Dictionary says about one TABLE.FIELD value, as api/services/ddic_value_check.py reports it: the
 * field's text, data element, domain, type and length, its check table and where the table's values came from, each
 * check that failed, and the nearest valid codes when a value list rejected it. Shared by the entry gate and Cleansing.
 */

const VERDICT = { safe: "go", unknown: "at-risk", reject: "no-go" } as const;

export function verdictWord(v: Evidence["verdict"]): string {
  return v === "safe" ? t("SAP accepts it") : v === "reject" ? t("SAP would reject it") : t("Not checked");
}

export function SafetyBadge({ verdict }: { verdict: Evidence["verdict"] }) {
  return <span data-testid="ddic-verdict"><VerdictMark verdict={VERDICT[verdict]} /> {verdictWord(verdict)}</span>;
}

function sourceWord(e: Evidence): string {
  if (!e.check_table) return t("no check table");
  if (e.source === "live") return t("check table {table}, read from the system", { table: e.check_table });
  if (e.source === "baseline") return t("check table {table}, SAP-standard values", { table: e.check_table });
  return t("check table {table}, not read", { table: e.check_table });
}

export function DdicCard({ e }: { e?: Evidence | null }) {
  if (!e) return <Dash why={t("The SAP dictionary does not know this field.")} />;
  const size = e.type ? `${e.type} ${e.length ?? ""}${e.decimals ? `,${e.decimals}` : ""}`.trim() : null;
  return (
    <div data-testid="ddic-card">
      <div>
        <Mono>{e.field}</Mono> {e.field_text ?? ""}{" "}
        <span className="m2-meta">
          {[e.data_element && t("data element {de}", { de: e.data_element }), e.domain && t("domain {d}", { d: e.domain }), size, sourceWord(e)].filter(Boolean).join(", ")}
        </span>
      </div>
      {e.reasons.length ? <ul data-testid="ddic-reasons">{e.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
      {e.nearest.length ? (
        <div data-testid="ddic-nearest">
          {t("Did you mean")}{" "}
          {e.nearest.map((n) => <span key={n.code}><Mono>{n.code}</Mono> {n.text ?? ""}{" "}</span>)}
        </div>
      ) : null}
    </div>
  );
}

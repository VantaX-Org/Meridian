/** "business_partner" -> "Business Partner" */
export function formatModuleName(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Relative time: "2 hours ago", "3 days ago" */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Plain-English names for the check engine's check_class ids (checks/runner.py REGISTRY). */
const CHECK_CLASS_LABELS: Record<string, string> = {
  null_check: "Required value",
  regex_check: "Pattern match",
  domain_value_check: "Allowed values",
  cross_field_check: "Field-to-field consistency",
  referential_check: "Exists in check table",
  freshness_check: "Date not too old",
  format_check: "Check digit or format",
  field_status_check: "Field status (required or hidden)",
  uniqueness_check: "No duplicates",
  value_placement_check: "Value in the right field",
  balance_check: "Debits equal credits",
  country_format_check: "Country-specific format",
  aggregate_check: "Group totals agree",
  interval_check: "Validity periods",
  exists_check: "Linked record exists",
  similarity_check: "Near-duplicates",
  group_sum_check: "Group total vs. limit",
  hierarchy_check: "Hierarchy loop",
};

/** "domain_value_check" -> "Allowed values"; unknown ids are humanized ("older_than_days" -> "Older than days"). */
export function checkClassLabel(id: string): string {
  if (Object.hasOwn(CHECK_CLASS_LABELS, id)) return CHECK_CLASS_LABELS[id];
  const s = id.replace(/_/g, " ").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const DATE_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const DATETIME_FMT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });

/** The one date style: "2 Oct 2026" or "2 Oct 2026, 05:09" (UTC). An unparseable value is an em dash. */
export function formatDate(iso: string | number | Date | null | undefined, kind: "date" | "datetime" = "date"): string {
  if (iso === null || iso === undefined || iso === "") return "—";
  const d = iso instanceof Date ? iso : new Date(typeof iso === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(iso) ? `${iso}Z` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return (kind === "date" ? DATE_FMT : DATETIME_FMT).format(d);
}

const LABEL_OVERRIDES: Record<string, string> = {
  not_yet_checked: "Not yet checked",
  pending_approval: "Pending approval",
  auth_failed: "Sign-in refused",
};

/** "pending_approval" -> "Pending approval": a status or other machine value as a sentence-case label. */
export function labelOf(value: string | null | undefined): string {
  if (!value) return "—";
  if (Object.hasOwn(LABEL_OVERRIDES, value)) return LABEL_OVERRIDES[value];
  const s = value.replace(/[_-]+/g, " ").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const ERROR_LABELS: Record<string, string> = {
  pyrfc_not_installed: "SAP RFC library is not installed on the worker. Install pyrfc or use file import.",
};

/** A job error such as "pyrfc_not_installed: build the wheel" as a sentence; unknown codes are humanized. */
export function errorLabel(error: string | null | undefined): string {
  if (!error) return "—";
  const code = error.split(":")[0].trim();
  if (Object.hasOwn(ERROR_LABELS, code)) return ERROR_LABELS[code];
  return humanizeIds(error);
}

/** Server copy with machine ids ("accounts_payable") rewritten as names ("Accounts Payable"). */
export function humanizeIds(text: string): string {
  return text.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, formatModuleName);
}

/** The eight DAMA-style dimensions the rule library is organised by, in matrix order. */
export const DIMENSIONS = [
  { id: "completeness", label: "Completeness" },
  { id: "consistency", label: "Consistency" },
  { id: "validity", label: "Validity" },
  { id: "accuracy", label: "Accuracy" },
  { id: "uniqueness", label: "Uniqueness" },
  { id: "timeliness", label: "Timeliness" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "freshness", label: "Freshness" },
] as const;

/** Where a rule's authority comes from, as a sentence. */
export const AUTHORITY_SENTENCE: Record<string, string> = {
  sap_hard_constraint: "SAP hard constraint: SAP itself rejects or breaks on this.",
  sap_standard: "SAP standard: SAP itself requires or enforces this.",
  sap_documented: "SAP documented: SAP documentation recommends this.",
  best_practice: "Best practice: not enforced by SAP, but widely expected.",
  industry_best_practice: "Industry best practice: not enforced by SAP, but widely expected.",
  regulatory: "Regulatory: a legal or tax rule requires this.",
  iso_standard: "ISO standard: an international standard requires this.",
  s4hana_migration: "S/4HANA migration: this must be clean before the move to S/4HANA.",
  customer_configured: "Customer configured: your own organisation defined this rule.",
};

/** A check-engine expression with its backticks and operators put into words. */
const plainExpr = (s: string) => s.replace(/`/g, "").replace(/\s*&\s*/g, " and ").replace(/\s*\|\s*/g, " or ")
  .replace(/\.isna\(\)/g, " is blank").replace(/\.notna\(\)/g, " is filled").replace(/==/g, "equals");

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);
const some = (xs: string[], n = 6) => (xs.length > n ? `${xs.slice(0, n).join(", ")} and ${xs.length - n} more` : xs.join(", "));

/** The condition under which a rule fails a record, in a sentence. Falls back to the rule's own message. */
export function failsWhen(rule: {
  check_class?: string | null; field?: string | null; fail_when?: unknown; allowed_values?: unknown; pattern?: string | null;
  reference_table?: string | null; reference_field?: string | null; max_age_hours?: number | null; target_table?: string | null;
  target_fields?: unknown; group_by?: unknown; message?: string | null; extra?: Record<string, unknown>;
}): string {
  const f = rule.field ?? "the field";
  const e = rule.extra ?? {};
  if (typeof rule.fail_when === "string" && rule.fail_when.trim()) return `Fails when ${plainExpr(rule.fail_when)}.`;
  switch (rule.check_class) {
    case "null_check": return `Fails when ${f} is blank.`;
    case "regex_check": return rule.pattern ? `Fails when ${f} does not match the pattern ${rule.pattern}.` : `Fails when ${f} has the wrong format.`;
    case "domain_value_check": {
      const v = list(rule.allowed_values);
      return v.length ? `Fails when ${f} is not one of ${some(v)}.` : `Fails when ${f} holds a value outside the allowed list.`;
    }
    case "referential_check":
      return rule.reference_table ? `Fails when ${f} has no entry in ${rule.reference_table}${rule.reference_field ? `.${rule.reference_field}` : ""}.`
        : `Fails when ${f} is not in the reference list.`;
    case "freshness_check": return rule.max_age_hours != null ? `Fails when ${f} is older than ${rule.max_age_hours.toLocaleString()} hours.` : `Fails when ${f} is too old.`;
    case "uniqueness_check": {
      const g = list(e.fields ?? rule.group_by);
      return g.length ? `Fails when more than one record has the same ${some(g)}.` : `Fails when more than one record has the same ${f}.`;
    }
    case "exists_check": {
      const t = list(rule.target_fields);
      return rule.target_table ? `Fails when no ${rule.target_table} record${t.length ? ` matches on ${some(t)}` : " exists"}.` : "Fails when the linked record is missing.";
    }
    default: break;
  }
  return rule.message ? `Fails when the record breaks this rule: ${rule.message}` : "The rule has no stated condition.";
}

/** "MATNR=100|WERKS=1000" -> [{ key: "MATNR", value: "100" }, ...] */
export function recordKeyParts(key: string): { key: string; value: string }[] {
  return key.split("|").map((p) => {
    const i = p.indexOf("=");
    return i < 0 ? { key: "", value: p } : { key: p.slice(0, i), value: p.slice(i + 1) };
  }).filter((p) => p.value !== "" || p.key !== "");
}

const OBJECT_NOUN: Record<string, string> = {
  material_master: "Material", business_partner: "Business partner", customer_master: "Customer", vendor_master: "Vendor",
  gl_account: "G/L account", cost_center: "Cost centre", profit_center: "Profit centre", equipment: "Equipment",
};
/** Singular noun for one record of a module: "material_master" -> "Material". */
export function objectNoun(module: string): string {
  return OBJECT_NOUN[module] ?? formatModuleName(module).replace(/ (Master|Data)$/, "");
}

const KEY_LABEL: Record<string, string> = { LIFNR: "vendor", KUNNR: "customer", MATNR: "material", BUKRS: "company code", WERKS: "plant", EKORG: "purchasing org", VKORG: "sales org", VTWEG: "distribution channel", SPART: "division", LGORT: "storage location", KOKRS: "controlling area", KOSTL: "cost centre", SAKNR: "account", EBELN: "purchase order", VBELN: "document" };

/** "BUKRS" -> "company code": a record key field as a noun; unknown fields are lower-cased. */
export function keyFieldLabel(field: string): string {
  return KEY_LABEL[field.toUpperCase()] ?? field.toLowerCase();
}

/** "LIFNR=V3|BUKRS=1000" becomes "Vendor V3, company code 1000". A key that is not field=value pairs is returned as is. */
export function recordKeyLabel(key: string): string {
  const parts = key.split("|").map((p) => p.split("="));
  if (!parts.every((p) => p.length === 2 && p[0] && p[1])) return key;
  const text = parts.map(([k, v]) => `${keyFieldLabel(k)} ${v}`).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

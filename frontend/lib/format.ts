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

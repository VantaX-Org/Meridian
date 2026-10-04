/** Score color: green >=85, amber 60-84, red <60 */
export function scoreColor(score: number): string {
  if (score >= 85) return "#256F3A";
  if (score >= 60) return "#E76500";
  return "#BB0000";
}

export function scoreBg(score: number): string {
  if (score >= 85) return "bg-[#256F3A]/10 text-[#256F3A]";
  if (score >= 60) return "bg-[#E76500]/10 text-[#E76500]";
  return "bg-[#BB0000]/10 text-[#BB0000]";
}

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

/** Severity badge pill classes */
export function severityColor(severity: string): string {
  switch (severity) {
    case "critical":
      return "bg-[#BB0000]/10 text-[#BB0000] border border-[#BB0000]/20";
    case "high":
      return "bg-[#E76500]/10 text-[#E76500] border border-[#E76500]/20";
    case "medium":
      return "bg-[#A45D00]/10 text-[#A45D00] border border-[#A45D00]/20";
    case "low":
      return "bg-[#089DE3]/10 text-[#089DE3] border border-[#089DE3]/20";
    default:
      return "bg-black/[0.03] text-[#6B7280] border border-black/[0.08]";
  }
}

export function passRateColor(rate: number): string {
  if (rate >= 95) return "bg-[#256F3A]";
  if (rate >= 80) return "bg-[#E76500]";
  return "bg-[#BB0000]";
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

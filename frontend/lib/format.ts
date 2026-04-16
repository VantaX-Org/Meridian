/** Score color: green >=85, amber 60-84, red <60 */
export function scoreColor(score: number): string {
  if (score >= 85) return "#16A34A";
  if (score >= 60) return "#D97706";
  return "#DC2626";
}

export function scoreBg(score: number): string {
  if (score >= 85) return "bg-[#16A34A]/10 text-[#16A34A]";
  if (score >= 60) return "bg-[#D97706]/10 text-[#D97706]";
  return "bg-[#DC2626]/10 text-[#DC2626]";
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
      return "bg-[#DC2626]/10 text-[#DC2626] border border-[#DC2626]/20";
    case "high":
      return "bg-[#EA580C]/10 text-[#EA580C] border border-[#EA580C]/20";
    case "medium":
      return "bg-[#D97706]/10 text-[#D97706] border border-[#D97706]/20";
    case "low":
      return "bg-[#00D4AA]/10 text-[#00D4AA] border border-[#00D4AA]/20";
    default:
      return "bg-black/[0.03] text-[#6B7280] border border-black/[0.08]";
  }
}

export function passRateColor(rate: number): string {
  if (rate >= 95) return "bg-[#16A34A]";
  if (rate >= 80) return "bg-[#D97706]";
  return "bg-[#DC2626]";
}

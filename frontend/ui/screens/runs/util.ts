import type { VersionHead } from "@/lib/api/v2/runs";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { f1 } from "@/lib/v2/score";

export const runPath = (id: string) => `/run/${id}`;

/** The name a person knows a run by: its label, else its number. */
export function runTitle(h: Pick<VersionHead, "label" | "run_number" | "id">): string {
  return h.label?.trim() || (h.run_number != null ? t("Run {n}", { n: h.run_number }) : h.id.slice(0, 8));
}

/** The objects a run scored, from its score summary, else its recorded modules. */
export function modulesOf(h: VersionHead): string[] {
  const k = Object.keys(h.dqs_summary ?? {});
  return k.length ? k : (h.metadata?.modules ?? []);
}

/** The run's overall score: the mean of the shown score of every object it scored. Null when it scored none. */
export function runScore(h: VersionHead): number | null {
  const v = Object.values(h.dqs_summary ?? {}).map((s) => s.composite_score ?? s.raw_score).filter((x): x is number => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export const scoreText = (n: number | null): string => (n === null ? t("n/a") : f1(n).replace(/[.,]0$/, ""));

/** How the run came about. */
export function sourceLabel(h: VersionHead): string {
  const m = h.metadata;
  if (m?.upload_id || m?.source === "upload") return t("Cleaned file uploaded");
  if (m?.source === "extraction" || m?.source === "pull") return t("Pulled from SAP");
  return m?.trigger === "scheduled" ? t("Scheduled") : t("Analysis");
}

export function statusLabel(s: string): string {
  switch (s) {
    case "complete": case "completed": return t("Complete");
    case "failed": return t("Failed");
    case "running": case "analysing": case "active": return t("Running");
    case "queued": case "pending": return t("Queued");
    case "cancelled": return t("Cancelled");
    default: return s;
  }
}

export const statusTone = (s: string): "good" | "bad" | "info" => (s === "complete" || s === "completed" ? "good" : s === "failed" || s === "cancelled" ? "bad" : "info");

export const when = (iso: string | number | null | undefined) => formatDate(iso, "datetime");

export const isLive = (s: string) => ["running", "analysing", "active", "queued", "pending"].includes(s);

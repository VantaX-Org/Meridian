/**
 * Pure helpers of the object page: a run's number, kind, score and status in words, the sentence under the Cycle tab,
 * and the last run chosen per object (sessionStorage, so a new tab starts on the newest run).
 */
import type { VersionHead } from "@/lib/api/v2/runs";
import type { RunOption } from "@/design/next/kit";
import { kindWord, shortDate, triggerOf } from "@/design/v2/RunTimeline";
import { f1 } from "@/lib/v2/score";

/** A score with one decimal, the decimal left off when it is zero ("77", "77.5"). */
export const score = (n: number): string => { const r = Math.round(n * 10) / 10; return Number.isInteger(r) ? f1(r).replace(/[.,]0$/, "") : f1(r); };
import { t } from "@/lib/v2/i18n";

export const isCleaned = (h: Pick<VersionHead, "parent_version_id">): boolean => Boolean(h.parent_version_id);

/** The shown score of one object in a run (after any cap), or null when the run did not score it. */
export function dqsOf(h: VersionHead | null | undefined, module: string): number | null {
  const s = h?.dqs_summary?.[module];
  return s ? (s.composite_score ?? s.raw_score ?? null) : null;
}

export function statusOf(h: Pick<VersionHead, "status">): RunOption["status"] {
  const s = h.status.toLowerCase();
  if (s === "failed" || s === "error" || s === "cancelled") return "failed";
  if (s === "complete" || s === "completed" || s === "finished" || s === "agents_complete" || s === "archived") return "done";
  return "running";
}

/** "Cleaned" for a run made from an uploaded workbook, else what started it ("Scheduled", "Manual"). */
export function kindOf(h: VersionHead): string {
  if (isCleaned(h)) return t("Cleaned");
  return kindWord(triggerOf(null, h.metadata));
}

export function numberOf(h: Pick<VersionHead, "run_number" | "id"> | null | undefined): number | null {
  return h?.run_number ?? null;
}

/** A run head as one row of the run switcher. Chips come from compare summaries already in the cache. */
export function toOption(h: VersionHead, module: string, parentNumber: number | null, chips?: RunOption["chips"]): RunOption {
  const d = dqsOf(h, module);
  return {
    id: h.id,
    number: h.run_number ?? 0,
    status: statusOf(h),
    kind: kindOf(h),
    parentNumber: parentNumber ?? undefined,
    dateLabel: shortDate(h.run_at),
    dqs: d === null ? undefined : score(d),
    chips,
  };
}

/** "+6", "-2.5", "0": a signed score difference with one decimal at most. */
export function signed(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r > 0 ? `+${score(r)}` : r < 0 ? `-${score(-r)}` : "0";
}

/** "Cycle 4, Run 15, cleaned from run 14, DQS 77 (+6)": the line under the Cycle tab name. */
export function cycleLine(cycle: number | null, run: number | null, parent: number | null, dqs: number | null, delta: number | null): string {
  const parts: string[] = [];
  if (cycle !== null) parts.push(t("Cycle {n}", { n: cycle }));
  if (run !== null) parts.push(parent !== null ? t("Run {n}, cleaned from run {p}", { n: run, p: parent }) : t("Run {n}", { n: run }));
  if (dqs !== null) parts.push(delta !== null ? t("DQS {score} ({delta})", { score: score(dqs), delta: signed(delta) }) : t("DQS {score}", { score: score(dqs) }));
  return parts.join(", ");
}

const KEY = (system: string, module: string) => `nx-run:${system}:${module}`; // i18n-ignore

export function rememberRun(system: string, module: string, id: string | null): void {
  try {
    if (id) sessionStorage.setItem(KEY(system, module), id);
    else sessionStorage.removeItem(KEY(system, module));
  } catch {
    // Storage blocked: the address still carries the run.
  }
}

export function recalledRun(system: string, module: string): string | null {
  try {
    return sessionStorage.getItem(KEY(system, module));
  } catch {
    return null;
  }
}

/** Seconds as "4 min 12 s", "38 s", "1 h 5 min". */
export function duration(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return "—";
  const v = Math.round(s);
  if (v < 60) return t("{s} s", { s: v });
  if (v < 3600) return t("{m} min {s} s", { m: Math.floor(v / 60), s: v % 60 });
  return t("{h} h {m} min", { h: Math.floor(v / 3600), m: Math.floor((v % 3600) / 60) });
}

/** One CSV cell: quoted when it holds a comma, quote or line break; a leading formula character is neutralised. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const REASONS: Record<string, () => string> = {
  new_rule: () => t("The rule is new in this run"),
  rule_removed: () => t("The rule no longer runs"),
  rule_changed: () => t("The rule changed between the runs"),
  records_added: () => t("Records were added to the object"),
  records_removed: () => t("Records were removed from the object"),
  data: () => t("The value in the record changed"),
};

/** A compare reason code in words, with the code kept beside it; text the server already wrote is shown as it came. */
export function reasonText(code: string | null | undefined): string {
  if (!code) return "—";
  const f = REASONS[code];
  return f ? `${f()} (${code})` : code;
}

/** A field map ({MEINS: ""}) as "MEINS: (empty)"; null when the record did not fail in that run. */
export function valuesText(v: Record<string, unknown> | null | undefined): string {
  if (!v) return t("Not failing");
  const parts = Object.entries(v).map(([k, x]) => `${k}: ${x === null || x === undefined || x === "" ? t("(empty)") : String(x)}`);
  return parts.length ? parts.join(", ") : t("(no values)");
}

import { clsx } from "clsx";
import { SeverityDot } from "./SeverityDot";

/**
 * The one status vocabulary. Three fixed sets, each value with one canonical label and tone:
 *
 * - verdict: can it go (readiness, migration waves, process steps, object readiness)
 * - severity: how bad is a finding or rule
 * - lifecycle: where a run, job or extraction is
 *
 * Callers pass the API value; `Status` normalises the known aliases (`at_risk`, `fail`, `agents_complete`, ...)
 * and owns the label. A value outside the set renders as a neutral pill with its humanised text, never a guess.
 */
export type Verdict = "go" | "at-risk" | "no-go";
export type SeverityLevel = "critical" | "high" | "medium" | "low";
export type Lifecycle = "queued" | "running" | "done" | "failed";
export type StatusKind = "verdict" | "severity" | "lifecycle";

type Tone = "neutral" | "info" | Verdict | SeverityLevel;

export const VERDICT: Record<Verdict, { label: string; tone: Tone }> = {
  go: { label: "Go", tone: "go" },
  "at-risk": { label: "At risk", tone: "at-risk" },
  "no-go": { label: "No-go", tone: "no-go" },
};
export const SEVERITY: Record<SeverityLevel, { label: string; tone: Tone }> = {
  critical: { label: "Critical", tone: "critical" },
  high: { label: "High", tone: "high" },
  medium: { label: "Medium", tone: "medium" },
  low: { label: "Low", tone: "low" },
};
export const LIFECYCLE: Record<Lifecycle, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  done: { label: "Done", tone: "go" },
  failed: { label: "Failed", tone: "no-go" },
};

const key = (v: string | null | undefined) => (v ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");

const VERDICT_ALIAS: Record<string, Verdict> = {
  go: "go", pass: "go", passed: "go", ready: "go", green: "go", "load-ready": "go", ok: "go", unaffected: "go",
  "at-risk": "at-risk", warn: "at-risk", warning: "at-risk", amber: "at-risk", degraded: "at-risk",
  "no-go": "no-go", fail: "no-go", failed: "no-go", red: "no-go", blocked: "no-go", blocking: "no-go", "not-ready": "no-go", "load-fail": "no-go",
};
const SEVERITY_ALIAS: Record<string, SeverityLevel> = {
  critical: "critical", high: "high", medium: "medium", warning: "medium", low: "low", info: "low",
};
const LIFECYCLE_ALIAS: Record<string, Lifecycle> = {
  queued: "queued", pending: "queued", scheduled: "queued", uploaded: "queued", waiting: "queued",
  running: "running", processing: "running", analysing: "running", analyzing: "running", "in-progress": "running", started: "running", extracting: "running", validating: "running", building: "running", mining: "running",
  done: "done", complete: "done", completed: "done", "agents-complete": "done", "ai-enriched": "done", ok: "done", success: "done", succeeded: "done", finished: "done",
  failed: "failed", "agents-failed": "failed", error: "failed", errored: "failed",
};

/** The verdict a raw API value stands for (`at_risk`, `fail`, `red`, `blocked` ...), or undefined. */
export const toVerdict = (v: string | null | undefined): Verdict | undefined => VERDICT_ALIAS[key(v)];
/** The severity a raw API value stands for (`warning` reads as medium, `info` as low), or undefined. */
export const toSeverity = (v: string | null | undefined): SeverityLevel | undefined => SEVERITY_ALIAS[key(v)];
/** The lifecycle stage a raw run, job or extraction status stands for, or undefined. */
export const toLifecycle = (v: string | null | undefined): Lifecycle | undefined => LIFECYCLE_ALIAS[key(v)];

const SETS = {
  verdict: { map: VERDICT as Record<string, { label: string; tone: Tone }>, norm: toVerdict },
  severity: { map: SEVERITY as Record<string, { label: string; tone: Tone }>, norm: toSeverity },
  lifecycle: { map: LIFECYCLE as Record<string, { label: string; tone: Tone }>, norm: toLifecycle },
} as const;

/** Canonical label of a value, or its humanised raw text when it is outside the set. */
export function statusLabel(kind: StatusKind, value: string | null | undefined): string {
  const v = SETS[kind].norm(value);
  if (v) return SETS[kind].map[v].label;
  const s = (value ?? "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—";
}

const DOT: ReadonlySet<Tone> = new Set(["go", "at-risk", "no-go"]);

/**
 * `<Status kind="verdict" value="at_risk" />`. `variant="solid"` is for the row's primary verdict or severity
 * (one column per table); never mix soft and solid in one column.
 */
export function Status({ kind, value, variant = "soft", count }: {
  kind: StatusKind;
  value: string | null | undefined;
  variant?: "soft" | "solid";
  /** A count of items in this state, shown after the label ("Critical: 3"). */
  count?: number;
}) {
  const v = SETS[kind].norm(value);
  const tone: Tone = v ? SETS[kind].map[v].tone : "neutral";
  const solid = variant === "solid";
  return (
    <span className={clsx("m-pill", solid ? `m-pill-solid-${tone}` : `m-pill-${tone}`)} data-status={kind} data-value={v ?? "unknown"}>
      {!solid && kind === "severity" && v ? <span aria-hidden className="inline-flex"><SeverityDot severity={v as SeverityLevel} /></span> : null}
      {!solid && kind !== "severity" && DOT.has(tone) ? <span className="m-pill-dot" aria-hidden="true" /> : null}
      {statusLabel(kind, value)}{count != null ? `: ${count.toLocaleString()}` : null}
    </span>
  );
}

/**
 * Learned monitors fixture, shaped like api/routes/learned_monitors.py: one active object with four breaks and one
 * object still learning. Decisions change the in-memory break so the screen shows them; the explanation is the
 * deterministic wording, as the route answers with no model.
 */
import type { LearnedBreak, LearnedMonitors, MonitorThreshold } from "../learned-monitors";

export const NONE_LEARNED_MONITORS = Symbol("not a learned monitor path");

const cite = (n: number[], cur: number) => [
  ...n.map((k) => ({ run_id: `run-${k}`, run_number: k, run_at: `2026-10-${String(k + 10).padStart(2, "0")}T04:10:00+00:00`, role: "baseline" as const })),
  { run_id: `run-${cur}`, run_number: cur, run_at: `2026-10-${String(cur + 10).padStart(2, "0")}T04:10:00+00:00`, role: "current" as const },
];
const base = { version_id: "run-12", run_number: 12, baseline_runs: 6, method: "mad", source: "run" as const, status: "open" as const, baseline_effect: null, snoozed_until: null, decided_by: null, decided_at: null, note: null, detected_at: "2026-10-22T04:30:00+00:00", citations: cite([6, 7, 8, 9, 10, 11], 12) };
const say = (s: string[]) => ({ source: "template" as const, sentences: s, dropped: 0 });

const BREAKS: LearnedBreak[] = [
  {
    ...base, id: "lm-1", module: "material_master", kind: "field_emptied", metric: "blank_pct", subject_code: "MARA.BRGEW", subject_description: "Gross weight",
    severity: "critical", expected_low: 0, expected_high: 6.4, median: 4.2, observed: 100,
    explanation: say(["Gross weight (MARA.BRGEW): the field is now empty at 100.0; the usual range is 0.0 to 6.4.", "The baseline is the median of 6 earlier runs, 4.2."]),
  },
  {
    ...base, id: "lm-2", module: "material_master", kind: "fail_rate_jump", metric: "fail_rate", subject_code: "MM014", subject_description: "Base unit not valid",
    severity: "high", expected_low: 0.8, expected_high: 3.1, median: 1.9, observed: 14.6,
    explanation: say(["Base unit not valid (MM014): the fail rate rose to 14.6; the usual range is 0.8 to 3.1.", "The baseline is the median of 6 earlier runs, 1.9."]),
  },
  {
    ...base, id: "lm-3", module: "material_master", kind: "volume_drop", metric: "records", subject_code: "", subject_description: null,
    severity: "medium", expected_low: 47_100, expected_high: 49_000, median: 48_050, observed: 33_400,
    explanation: say(["Material master: records checked fell to 33,400; the usual range is 47,100 to 49,000.", "The baseline is the median of 6 earlier runs, 48,050."]),
  },
  {
    ...base, id: "lm-4", module: "material_master", kind: "score_drop", metric: "score", subject_code: "", subject_description: null,
    severity: "low", expected_low: 86.4, expected_high: 89.6, median: 88.1, observed: 84.9, status: "acknowledged", decided_by: "Demo steward", decided_at: "2026-10-22T09:00:00+00:00",
    explanation: say(["Material master: the score fell to 84.9; the usual range is 86.4 to 89.6.", "The baseline is the median of 6 earlier runs, 88.1."]),
  },
];

/** Run 13 landed 4,100 rows after run 12 and its analysis has not finished: found between full runs. */
const INTERIM: LearnedBreak[] = [
  {
    ...base, id: "lm-i1", version_id: "run-13", run_number: 13, source: "interim", module: "sd_customer_master", kind: "volume_drop", metric: "records",
    subject_code: "", subject_description: null, severity: "high", expected_low: 11_800, expected_high: 12_600, median: 12_200, observed: 4_100,
    detected_at: "2026-10-23T09:15:00+00:00", citations: cite([7, 8, 9, 10, 11, 12], 13),
    explanation: say([
      "Found between full runs: the extraction landed 4,100 rows before its analysis finished. Compared with the rows of earlier syncs of this object, not with a finished run.",
      "SD customer master: records checked fell to 4,100; the usual range is 11,800 to 12,600.",
    ]),
  },
];

const COVERAGE: LearnedMonitors["coverage"] = [
  { module: "material_master", run_id: "run-12", run_number: 12, baseline_runs: 6, min_runs: 5, state: "active", breaks: 4 },
  { module: "sd_customer_master", run_id: "run-12", run_number: 12, baseline_runs: 3, min_runs: 5, state: "learning", breaks: 0 },
];

const THRESHOLDS: MonitorThreshold[] = [
  {
    module: "material_master", metric: "fail_rate", subject_code: "MM014", subject_description: "Base unit not valid",
    min_effect: 5.25, floor: 2, ceiling: 6, window_days: 90,
    moves: [
      { break_id: "lm-0b", run_number: 11, decision: "expected", effect: 5, result: "raised", min_effect_after: 5.25, decided_by: "Demo steward", decided_at: "2026-10-21T09:00:00+00:00" },
      { break_id: "lm-0a", run_number: 9, decision: "expected", effect: 3, result: "raised", min_effect_after: 3.15, decided_by: "Demo steward", decided_at: "2026-10-12T09:00:00+00:00" },
    ],
  },
];

const mem = new Map<string, LearnedBreak>([...BREAKS, ...INTERIM].map((b) => [b.id, { ...b }]));
export const resetLearnedMonitors = () => [...BREAKS, ...INTERIM].forEach((b) => mem.set(b.id, { ...b }));

export function learnedMonitorsRead(path: string): unknown {
  if (path !== "/aletheia/monitors") return NONE_LEARNED_MONITORS;
  const all = [...mem.values()];
  return { min_runs: 5, history: 30, coverage: COVERAGE, breaks: all.filter((b) => b.source === "run"), thresholds: THRESHOLDS, interim: all.filter((b) => b.source === "interim") } satisfies LearnedMonitors;
}

export function learnedMonitorsWrite(method: string, path: string, body: unknown): unknown {
  const m = /^\/aletheia\/monitors\/([^/]+)\/(acknowledge|expected|snooze|explain)$/.exec(path);
  if (method !== "POST" || !m) return NONE_LEARNED_MONITORS;
  const b = mem.get(m[1]);
  if (!b) throw Object.assign(new Error("Break not found"), { status: 404, response: { status: 404, data: { detail: "Break not found" } } });
  const x = (body ?? {}) as { effect?: "exclude" | "accept"; days?: number; note?: string };
  const stamp = { decided_by: "Demo steward", decided_at: "2026-10-23T08:00:00+00:00", note: x.note ?? null };
  if (m[2] === "acknowledge") Object.assign(b, stamp, { status: "acknowledged" });
  if (m[2] === "expected") Object.assign(b, stamp, { status: "expected", baseline_effect: x.effect ?? "exclude" });
  if (m[2] === "snooze") Object.assign(b, stamp, { status: "snoozed", snoozed_until: "2026-11-06T08:00:00+00:00" });
  return { ...b };
}

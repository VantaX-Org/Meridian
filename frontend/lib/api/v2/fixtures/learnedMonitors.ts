/**
 * Learned monitors fixture, shaped like api/routes/learned_monitors.py: one active object with eight breaks, one below a raised minimum, and one
 * object still learning. Decisions change the in-memory break so the screen shows them; the explanation is the
 * deterministic wording, as the route answers with no model.
 */
import type { BreakEvidence, FieldContext, LearnedBreak, LearnedMonitors, MonitorThreshold } from "../learned-monitors";

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
  {
    ...base, id: "lm-6", module: "material_master", kind: "pattern_shift", metric: "pattern_pct", subject_code: "MARA.MTART", subject_description: "Material type",
    severity: "medium", expected_low: 0, expected_high: 2.4, median: 0.8, observed: 31.5,
    explanation: say(["Material type (MARA.MTART): the share of values in an unusual shape rose to 31.5; the usual range is 0.0 to 2.4.", "The baseline is the median of 6 earlier runs, 0.8."]),
  },
  {
    ...base, id: "lm-7", module: "material_master", kind: "format_break", metric: "unparse_pct", subject_code: "MARA.NTGEW", subject_description: "Net weight",
    severity: "high", expected_low: 0, expected_high: 1.2, median: 0.1, observed: 22.4,
    explanation: say(["Net weight (MARA.NTGEW): the share of values that do not parse rose to 22.4; the usual range is 0.0 to 1.2.", "The baseline is the median of 6 earlier runs, 0.1."]),
  },
  {
    ...base, id: "lm-8", module: "material_master", kind: "range_shift", metric: "num_mean", subject_code: "MARA.BRGEW", subject_description: "Gross weight",
    severity: "medium", expected_low: 0.9, expected_high: 1.6, median: 1.2, observed: 3.1,
    explanation: say(["Gross weight (MARA.BRGEW): the mean moved by 158.3% from its usual level.", "The baseline is the median of 6 earlier runs."]),
  },
  {
    ...base, id: "lm-9", module: "material_master", kind: "range_shift", metric: "date_max", subject_code: "MARA.LAEDA", subject_description: "Date of last change",
    severity: "low", expected_low: 739860, expected_high: 739895, median: 739890, observed: 738900,
    explanation: say(["Date of last change (MARA.LAEDA): the latest date fell back by 990.0 days from its usual level.", "The baseline is the median of 6 earlier runs."]),
  },
];

/** Outside the usual range, but 3.4 points is under the 4.2 minimum a steward raised for this rule: stored, not alerted. */
const QUIET: LearnedBreak[] = [
  {
    ...base, id: "lm-5", module: "material_master", kind: "fail_rate_jump", metric: "fail_rate", subject_code: "MM021", subject_description: "Material group missing",
    severity: "low", expected_low: 0.2, expected_high: 1.6, median: 0.9, observed: 4.3, status: "below_minimum",
    explanation: say(["Material group missing (MM021): the fail rate rose to 4.3; the usual range is 0.2 to 1.6.", "The baseline is the median of 6 earlier runs, 0.9."]),
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
  { module: "material_master", run_id: "run-12", run_number: 12, baseline_runs: 6, min_runs: 5, state: "active", breaks: 8 },
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
  {
    module: "material_master", metric: "fail_rate", subject_code: "MM021", subject_description: "Material group missing",
    min_effect: 4.2, floor: 2, ceiling: 6, window_days: 90,
    moves: [
      { break_id: "lm-0c", run_number: 10, decision: "expected", effect: 4, result: "raised", min_effect_after: 4.2, decided_by: "Demo steward", decided_at: "2026-10-16T09:00:00+00:00" },
    ],
  },
];

const mem = new Map<string, LearnedBreak>([...BREAKS, ...QUIET, ...INTERIM].map((b) => [b.id, { ...b }]));
export const resetLearnedMonitors = () => [...BREAKS, ...QUIET, ...INTERIM].forEach((b) => mem.set(b.id, { ...b }));

/** DDIC entries from the repo dictionary (ecc6) for the fixture's field subjects. */
const FIELDS: Record<string, FieldContext> = {
  "MARA.MTART": { table: "MARA", field: "MTART", table_text: "General Material Data", description: "Material type", data_element: "MTART", domain: "MTART", type: "CHAR", length: 4, check_table: "T134", check_field: "MTART", fixed_values: [], fixed_values_total: 0 },
  "MARA.BRGEW": { table: "MARA", field: "BRGEW", table_text: "General Material Data", description: "Gross weight", data_element: "BRGEW", domain: "MENG13", type: "QUAN", length: 13, check_table: null, check_field: null, fixed_values: [], fixed_values_total: 0 },
};

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const OFFSETS = [-0.9, -0.4, -0.1, 0.1, 0.5, 0.8];

/** Six synthetic baseline values spread around the stored median, then the same robust z the route computes. */
function evidence(b: LearnedBreak): BreakEvidence {
  const lo = b.expected_low ?? 0, hi = b.expected_high ?? 0, med0 = b.median ?? (lo + hi) / 2;
  const step = (hi - lo) / 7;
  const runs = b.citations.filter((c) => c.role === "baseline").map((c, i) => ({ run_id: c.run_id, run_number: c.run_number, run_at: c.run_at, value: Math.max(0, +(med0 + OFFSETS[i % 6] * step).toFixed(2)) }));
  const vals = runs.map((r) => r.value), med = median(vals), mad = median(vals.map((v) => Math.abs(v - med)));
  const scaled = +(1.4826 * mad).toFixed(4);
  return {
    break_id: b.id, metric: b.metric, subject_code: b.subject_code, observed: b.observed, expected_low: b.expected_low, expected_high: b.expected_high,
    basis: "runs", median: med, mad: +mad.toFixed(4), scaled_mad: scaled, z: scaled > 0 ? +((b.observed - med) / scaled).toFixed(2) : null,
    z_threshold: 3.5, floored: scaled * 3.5 < (hi - lo) / 2 - 1e-9, runs, field: FIELDS[b.subject_code] ?? null,
    values: b.id === "lm-6" ? {
      baseline_runs: 6, check_table_snapshot: true,
      appeared: [{ value: "ZRW1", text: null, in_check_table: false, count: 14_920 }, { value: "UNBW", text: "Non-valuated material", in_check_table: true, count: 310 }],
      vanished: [{ value: "HAWA", text: "Trading good", in_check_table: true, runs: 6 }],
    } : null,
  };
}

export function learnedMonitorsRead(path: string): unknown {
  const ev = /^\/aletheia\/monitors\/([^/]+)\/evidence$/.exec(path);
  if (ev) {
    const b = mem.get(ev[1]);
    if (!b) throw Object.assign(new Error("Break not found"), { status: 404, response: { status: 404, data: { detail: "Break not found" } } });
    return evidence(b) satisfies BreakEvidence;
  }
  if (path !== "/aletheia/monitors") return NONE_LEARNED_MONITORS;
  const all = [...mem.values()];
  return { min_runs: 5, history: 30, coverage: COVERAGE, breaks: all.filter((b) => b.source === "run" && b.status !== "below_minimum"), below_minimum: all.filter((b) => b.status === "below_minimum"), thresholds: THRESHOLDS, interim: all.filter((b) => b.source === "interim") } satisfies LearnedMonitors;
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

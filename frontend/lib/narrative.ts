import type { VersionComparison } from "@/types/api";
import type { RecordDiff } from "@/lib/api/versions";
import { formatModuleName, formatNumber, roundedDelta } from "@/lib/format";

// One number format with the rest of the app: the viewer's locale (lib/format.ts), never a fixed one.
const nf = { format: (n: number) => formatNumber(n) };
const score = (n: number) => n.toFixed(1);
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
const plural = (n: number, one: string, many: string) => `${nf.format(n)} ${n === 1 ? one : many}`;

function overallSentence(cmp: VersionComparison): string | null {
  const deltas = Object.values(cmp.delta);
  if (deltas.length === 0) return null;
  const mean = (pick: (d: (typeof deltas)[number]) => number) => deltas.reduce((a, d) => a + pick(d), 0) / deltas.length;
  const before = mean((d) => d.v1_score);
  const after = mean((d) => d.v2_score);
  const delta = roundedDelta(before, after);
  // Guard against "-0.0"
  const deltaFormatted = delta === 0 ? "+0.0" : signed(delta);
  return `DQS moved from ${score(before)} to ${score(after)} (${deltaFormatted}) across ${plural(deltas.length, "module", "modules")}.`;
}

function moverSentence(cmp: VersionComparison): string | null {
  const entries = Object.entries(cmp.delta).filter(([, d]) => d.dqs_change !== 0);
  if (entries.length === 0) return null;
  const [name, d] = entries.sort(([, a], [, b]) => Math.abs(b.dqs_change) - Math.abs(a.dqs_change))[0];
  const verb = d.dqs_change > 0 ? "improved" : "declined";
  // The driver moved the same way as the score: "improved, driven by uniqueness (-0.9)" contradicted itself. A
  // dimension that moved against the score is named as such, after the driver.
  const up = d.dqs_change > 0;
  const dims = Object.entries(d.dimensions)
    .filter(([, dim]) => dim.change !== null && dim.change !== 0)
    .sort(([, a], [, b]) => Math.abs(b.change!) - Math.abs(a.change!));
  const withScore = dims.find(([, dim]) => (dim.change! > 0) === up);
  const against = dims.find(([, dim]) => (dim.change! > 0) !== up);
  const driver = withScore
    ? `, driven by ${withScore[0]} (${signed(withScore[1].change!)})${against ? ` despite ${against[0]} (${signed(against[1].change!)})` : ""}`
    : "";
  return `${formatModuleName(name)} ${verb} most (${signed(d.dqs_change)})${driver}.`;
}

function regressionSentence(cmp: VersionComparison): string | null {
  const failing = [...cmp.checks.newly_failing].sort((a, b) => b.v2_affected - a.v2_affected);
  if (failing.length === 0) return null;
  const listed = failing.slice(0, 3).map((c) => `${c.check_id} (${c.severity}, ${nf.format(c.v2_affected)} records)`);
  const more = failing.length > 3 ? `, and ${nf.format(failing.length - 3)} more` : "";
  const head = failing.length === 1 ? "1 rule newly fails" : `${nf.format(failing.length)} rules newly fail`;
  return `${head}: ${listed.join(", ")}${more}.`;
}

/**
 * The fixed rules and the rule failures they held, which the table's fixed rows sum to; then, when the record diff is
 * read, the rule failures resolved and new across every rule (most of them on rules that still fail). Each is a
 * record failing one rule (lib/help/glossary.ts "Rule failures"), never "records": "10,521 records resolved" sat
 * above a table of 4 fixed rules holding 6.
 */
function fixedSentence(cmp: VersionComparison, diff: RecordDiff | null): string | null {
  const n = cmp.checks.fixed.length;
  if (n === 0) return null;
  const held = cmp.checks.fixed.reduce((a, c) => a + c.v1_affected, 0);
  const head = `${plural(n, "rule", "rules")} fixed, which had ${plural(held, "rule failure", "rule failures")}`;
  if (!diff) return `${head}.`;
  return `${head}; across every rule, ${plural(diff.totals.resolved, "rule failure", "rule failures")} resolved and ${nf.format(diff.totals.new)} new.`;
}

function excludedSentence(diff: RecordDiff | null): string | null {
  const n = diff?.checks.filter((c) => !c.comparable).length ?? 0;
  if (n === 0) return null;
  return n === 1
    ? "1 rule did not run cleanly in both runs; its delta is excluded."
    : `${nf.format(n)} rules did not run cleanly in both runs; their deltas are excluded.`;
}

/** Template sentences describing a comparison. Pure; every number comes from the API payloads. */
export function compareNarrative(cmp: VersionComparison, diff: RecordDiff | null): string[] {
  return [overallSentence(cmp), moverSentence(cmp), regressionSentence(cmp), fixedSentence(cmp, diff), excludedSentence(diff)]
    .filter((s): s is string => s !== null);
}

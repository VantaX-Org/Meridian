import type { VersionComparison } from "@/types/api";
import type { RecordDiff } from "@/lib/api/versions";
import { formatModuleName } from "@/lib/format";

const nf = new Intl.NumberFormat("en-ZA");
const score = (n: number) => n.toFixed(1);
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
const plural = (n: number, one: string, many: string) => `${nf.format(n)} ${n === 1 ? one : many}`;

function overallSentence(cmp: VersionComparison): string | null {
  const deltas = Object.values(cmp.delta);
  if (deltas.length === 0) return null;
  const mean = (pick: (d: (typeof deltas)[number]) => number) => deltas.reduce((a, d) => a + pick(d), 0) / deltas.length;
  const before = mean((d) => d.v1_score);
  const after = mean((d) => d.v2_score);
  return `DQS moved from ${score(before)} to ${score(after)} (${signed(after - before)}) across ${plural(deltas.length, "module", "modules")}.`;
}

function moverSentence(cmp: VersionComparison): string | null {
  const entries = Object.entries(cmp.delta).filter(([, d]) => d.dqs_change !== 0);
  if (entries.length === 0) return null;
  const [name, d] = entries.sort(([, a], [, b]) => Math.abs(b.dqs_change) - Math.abs(a.dqs_change))[0];
  const verb = d.dqs_change > 0 ? "improved" : "declined";
  const dims = Object.entries(d.dimensions)
    .filter(([, dim]) => dim.change !== null)
    .sort(([, a], [, b]) => Math.abs(b.change!) - Math.abs(a.change!));
  const driver = dims[0] ? `, driven by ${dims[0][0]} (${signed(dims[0][1].change!)})` : "";
  return `${formatModuleName(name)} ${verb} most (${signed(d.dqs_change)})${driver}.`;
}

function regressionSentence(cmp: VersionComparison): string | null {
  const failing = [...cmp.checks.newly_failing].sort((a, b) => b.v2_affected - a.v2_affected);
  if (failing.length === 0) return null;
  const listed = failing.slice(0, 3).map((c) => `${c.check_id} (${c.severity}, ${nf.format(c.v2_affected)} records)`);
  const more = failing.length > 3 ? `, and ${nf.format(failing.length - 3)} more` : "";
  const head = failing.length === 1 ? "1 check newly fails" : `${nf.format(failing.length)} checks newly fail`;
  return `${head}: ${listed.join(", ")}${more}.`;
}

function fixedSentence(cmp: VersionComparison, diff: RecordDiff | null): string | null {
  const n = cmp.checks.fixed.length;
  if (n === 0) return null;
  const head = plural(n, "check fixed", "checks fixed");
  return diff ? `${head}, ${nf.format(diff.totals.resolved)} records resolved.` : `${head}.`;
}

function excludedSentence(diff: RecordDiff | null): string | null {
  const n = diff?.checks.filter((c) => !c.comparable).length ?? 0;
  if (n === 0) return null;
  return n === 1
    ? "1 check did not run cleanly in both runs; its delta is excluded."
    : `${nf.format(n)} checks did not run cleanly in both runs; their deltas are excluded.`;
}

/** Template sentences describing a comparison. Pure; every number comes from the API payloads. */
export function compareNarrative(cmp: VersionComparison, diff: RecordDiff | null): string[] {
  return [overallSentence(cmp), moverSentence(cmp), regressionSentence(cmp), fixedSentence(cmp, diff), excludedSentence(diff)]
    .filter((s): s is string => s !== null);
}

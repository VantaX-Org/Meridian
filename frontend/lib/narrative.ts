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

/**
 * The fixed checks and the records they held, which the table's fixed rows sum to; then, when the record diff is
 * read, the records resolved across every check (most of them by checks that still fail). The two used to share one
 * clause ("4 checks fixed, 10,521 records resolved") under a table of fixed rows summing to 6.
 */
function fixedSentence(cmp: VersionComparison, diff: RecordDiff | null): string | null {
  const n = cmp.checks.fixed.length;
  if (n === 0) return null;
  const held = cmp.checks.fixed.reduce((a, c) => a + c.v1_affected, 0);
  const head = `${plural(n, "check", "checks")} fixed (${plural(held, "record", "records")} they failed)`;
  if (!diff) return `${head}.`;
  return `${head}; across every check, ${plural(diff.totals.resolved, "record", "records")} resolved and ${nf.format(diff.totals.new)} newly failing.`;
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

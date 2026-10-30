/**
 * Pure parts of step 9: the ruler of a simulated receipt, the landscape sentence as words, wave gates, contract
 * marks, webhook presets and the change log's sums. No React and no fetching, so each is tested on its own.
 */
import { DIMENSIONS, type LandscapeCell, type WorkRow } from "@/lib/api/v2/types";
import type { ContractBreach, DriftAlert, SimSentence, SimState, WaveGateState, WebhookEvent } from "@/lib/api/v2/step9";
import { t } from "./i18n";
import { f1 } from "./score";

/** What the Ruler needs to draw one side of a simulation. A dimension the run did not measure stays null. */
export function rulerOfState(s: SimState): { dims: (number | null)[]; measured: number | null; score: number | null; capped: boolean; capLevel: number | null; breaches: string[] } {
  const capped = s.cap_level != null && s.raw_score != null && s.score != null && s.raw_score > s.score;
  return { dims: DIMENSIONS.map((d) => s.dimensions[d.key] ?? null), measured: s.raw_score, score: s.score, capped, capLevel: s.cap_level, breaches: s.breaches };
}

/** A list of ids in words: "MM001", "MM001 and MM005", "MM001, MM005 and MM015". */
export function listWords(ids: readonly string[]): string {
  if (ids.length <= 1) return ids[0] ?? "";
  return t("{list} and {last}", { list: ids.slice(0, -1).join(", "), last: ids[ids.length - 1] });
}

/** The cap in words: "Capped at 70 by MM003 and MM035", "No cap". */
export function capWords(s: SimState): string {
  const r = rulerOfState(s);
  if (!r.capped) return s.breaches.length ? t("Not capped: measured {measured} is under the cap of {cap}", { measured: f1(s.raw_score), cap: s.cap_level ?? (s.breaches.length >= 2 ? 70 : 85) }) : t("No cap: no critical rule over tolerance");
  const ids = s.breaches;
  return ids.length <= 2 ? t("Capped at {cap} by {rules}", { cap: s.cap_level ?? 0, rules: listWords(ids) }) : t("Capped at {cap} by {count} critical rules", { cap: s.cap_level ?? 0, count: ids.length });
}

/** A signed change with one decimal: "+15.0", "-1.2", "0.0"; a dash when unknown. */
export function signed1(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? "+" : r < 0 ? "-" : ""}${Math.abs(r).toFixed(1)}`;
}

/** A signed whole change: "+2", "-1", "0". */
export function signedInt(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n)}`;
}

/** The landscape's one sentence, as /landscape writes it, in plain words. */
export function sentenceWords(s: SimSentence): string {
  if (s.objects === 0) return t("No object has a run yet.");
  const head = t("{held} of {objects} objects are held under 85 by {critical} critical {critical, plural, one {rule} other {rules}} over tolerance", { held: s.held_under_85, objects: s.objects, critical: s.critical_over_tolerance });
  const ids = s.release_if_fixed;
  if (!ids.length || s.released <= 0) return t("{head}.", { head });
  return t("{head}; fixing {rules} would release {released} of them.", { head, rules: listWords(ids), released: s.released });
}

/** One wave's gate in words: "Wave 2: gate open" or "Wave 2: gate closed, 2 critical rule(s) over tolerance". */
export function gateWords(g: WaveGateState): string {
  return g.open ? t("{name}: gate open", { name: g.name }) : t("{name}: gate closed, {reasons}", { name: g.name, reasons: g.reasons.join(", ") });
}

/** Selected ledger rows by object, the largest group first: a simulation runs on one object at a time. */
export function recordsByModule(rows: readonly WorkRow[]): { module: string; records: { module: string; record_key: string }[] }[] {
  const by = new Map<string, { module: string; record_key: string }[]>();
  for (const r of rows) by.set(r.module, [...(by.get(r.module) ?? []), { module: r.module, record_key: r.record_key }]);
  return [...by.entries()].map(([module, records]) => ({ module, records })).sort((a, b) => b.records.length - a.records.length || a.module.localeCompare(b.module));
}

/** The contract mark of a matrix cell or ruler: null when nothing is breached. */
export function contractMark(cell: Pick<LandscapeCell, "contract_breaches" | "enforced_contract_breaches"> | null | undefined): { count: number; enforced: number; title: string } | null {
  const count = cell?.contract_breaches ?? 0;
  if (!count) return null;
  const enforced = cell?.enforced_contract_breaches ?? 0;
  return {
    count,
    enforced,
    title: enforced > 0 ? t("{count} data contract {count, plural, one {threshold} other {thresholds}} breached, {enforced} enforced: a baseline cannot be pinned", { count, enforced }) : t("{count} data contract {count, plural, one {threshold} other {thresholds}} breached, not enforced", { count }),
  };
}

function metricWord(metric: string): string {
  if (metric === "score") return t("Score");
  if (metric === "critical_breaches") return t("Critical rules over tolerance");
  return DIMENSIONS.find((d) => d.key === metric)?.label ?? metric;
}

/** A contract threshold in words: "Score 70.0, needs 85 or more". */
export function breachWords(b: ContractBreach): string {
  const actual = b.actual == null ? t("not measured") : b.metric === "critical_breaches" ? String(b.actual) : f1(b.actual);
  return b.metric === "critical_breaches" ? t("{metric} {actual}, needs at most {threshold}", { metric: metricWord(b.metric), actual, threshold: b.threshold }) : t("{metric} {actual}, needs {threshold} or more", { metric: metricWord(b.metric), actual, threshold: b.threshold });
}

export interface WebhookPreset {
  id: "slack" | "teams" | "custom";
  label: string;
  hint: string;
  placeholder: string;
  events: WebhookEvent[];
}

/** The webhook presets: the URL a Slack or Teams workflow gives you, and the events worth a channel post. */
export const WEBHOOK_PRESETS: readonly WebhookPreset[] = [
  { id: "slack", get label() { return t("Slack workflow"); }, get hint() { return t("Paste the URL of a Slack workflow that starts from a webhook. The workflow reads the event and the numbers from Meridian's JSON body."); }, placeholder: "https://hooks.slack.com/triggers/...", events: ["breach.new", "certificate.signed", "config.drift", "score.dropped"] },
  { id: "teams", get label() { return t("Teams workflow"); }, get hint() { return t("Paste the URL of a Teams workflow (Power Automate) that starts when a webhook request is received."); }, placeholder: "https://prod-00.westeurope.logic.azure.com/workflows/...", events: ["batch.waiting", "breach.new", "certificate.signed", "config.drift"] },
  { id: "custom", get label() { return t("Any https endpoint"); }, get hint() { return t("Meridian posts a signed JSON body. Check the X-Meridian-Signature header with the secret shown once after you save."); }, placeholder: "https://", events: ["run.finished", "run.failed"] },
];

/** An event as words; an event the list does not know reads as its name. */
export function eventWord(e: string): string {
  switch (e) {
    case "*":
      return t("Every event");
    case "run.finished":
      return t("A run finished");
    case "run.failed":
      return t("A run failed");
    case "batch.waiting":
      return t("A fix batch waits for approval");
    case "batch.approved":
      return t("A fix batch was approved");
    case "batch.sent":
      return t("A fix batch was sent to SAP");
    case "score.dropped":
      return t("A score dropped");
    case "breach.new":
      return t("A critical rule went over tolerance");
    case "config.drift":
      return t("SAP configuration changed");
    case "certificate.signed":
      return t("A readiness certificate was signed");
    case "webhook.test":
      return t("Test event");
    default:
      return e;
  }
}

/** The events of a webhook in words. */
export const eventsWords = (events: readonly string[]): string => (events.includes("*") ? eventWord("*") : events.map(eventWord).join(", "));

/** The changed areas of a drift alert, summed: "3 changes in T006 and T134". */
export function driftWords(a: Pick<DriftAlert, "areas">): string {
  const n = a.areas.reduce((s, x) => s + x.added + x.removed + x.changed, 0);
  const names = a.areas.map((x) => x.area);
  const list = names.length === 0 ? t("no area") : names.length <= 5 ? listWords(names) : t("{list} and {more} more", { list: names.slice(0, 5).join(", "), more: names.length - 5 });
  return t("{n} {n, plural, one {change} other {changes}} in {list}", { n, list });
}

/** The thresholds an editor holds as text, read back to numbers; an empty field is no threshold. Null when one is not a number from 0 to 100. */
export function thresholdsFromDraft(draft: { min_score: string; max_critical: string; dims: Record<string, string> }): { min_score?: number; max_critical_breaches?: number; dimensions?: Record<string, number> } | null {
  const num = (v: string, max: number): number | undefined | null => {
    if (!v.trim()) return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
  };
  const min = num(draft.min_score, 100);
  const crit = num(draft.max_critical, 100000);
  if (min === null || crit === null) return null;
  const dims: Record<string, number> = {};
  for (const [k, v] of Object.entries(draft.dims)) {
    const n = num(v, 100);
    if (n === null) return null;
    if (n !== undefined) dims[k] = n;
  }
  return { ...(min !== undefined ? { min_score: min } : {}), ...(crit !== undefined ? { max_critical_breaches: Math.round(crit) } : {}), ...(Object.keys(dims).length ? { dimensions: dims } : {}) };
}

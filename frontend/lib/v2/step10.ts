/**
 * Pure parts of step 10: the policy mark, the words of a prediction, the slots of a natural language answer, a record's
 * history in words and the digest vocabulary. No React and no fetching, so each is tested on its own.
 */
import type { LandscapeCell } from "@/lib/api/v2/types";
import type { Confidence, Digest, DigestChannel, HistoryEvent, NlMatch, PolicyPack, RunPrediction } from "@/lib/api/v2/step10";
import { t } from "./i18n";
import { whole } from "./format";

// ── policy ───────────────────────────────────────────────────────────────────

/** The policy mark of a matrix cell, ruler or receipt: null when no applied class is breached. */
export function policyMark(cell: Pick<LandscapeCell, "policy_breaches"> | { policy_breaches?: number } | null | undefined): { count: number; title: string } | null {
  const count = cell?.policy_breaches ?? 0;
  if (!count) return null;
  return { count, title: t("{count} policy {count, plural, one {class} other {classes}} breached: a critical rule evidencing an applied policy pack fails", { count }) };
}

/** A pack reference of the ledger's policy filter in words: "Vendor bank data (SOX financial controls)", or the pack's name. */
export function policyLabel(ref: string, packs: readonly PolicyPack[] | undefined): string {
  const [packId, classId] = ref.split(":");
  const p = packs?.find((x) => x.id === packId);
  if (!p) return ref;
  const c = classId ? p.classes.find((x) => x.id === classId) : undefined;
  return c ? t("{label} ({pack})", { label: c.label, pack: p.name }) : p.name;
}

/** A pass rate as "99.5%", or null when the rule was not measured. */
export function passRateText(rate: number | null | undefined): string | null {
  return rate == null ? null : `${(Math.round(rate * 10) / 10).toFixed(1)}%`;
}

// ── prediction ───────────────────────────────────────────────────────────────

/** A length of time in words: "45 s", "12 min", "1 h 05 min". */
export function spanWords(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return t("{n} s", { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return t("{n} min", { n: m });
  return t("{h} h {mm} min", { h: Math.floor(m / 60), mm: String(m % 60).padStart(2, "0") });
}

/** The predicted duration band: "9 min to 14 min", one value when both ends read the same, null when unknown. */
export function bandWords(p: Pick<RunPrediction["total"], "seconds_low" | "seconds_high" | "seconds">): string | null {
  if (p.seconds_low == null || p.seconds_high == null) return p.seconds == null ? null : spanWords(p.seconds);
  const lo = spanWords(p.seconds_low);
  const hi = spanWords(p.seconds_high);
  return lo === hi ? lo : t("{low} to {high}", { low: lo, high: hi });
}

export const CONFIDENCE_WORD: Record<Confidence, string> = { get high() { return t("high confidence"); }, get medium() { return t("medium confidence"); }, get low() { return t("low confidence"); }, get none() { return t("no past runs to predict from"); } };

/** Where a run started now would queue: "next", "2nd in the queue". */
export function queueWords(position: number): string {
  return position <= 1 ? t("Starts next") : t("Position {n} in the queue", { n: position });
}

/** A money amount with its currency, whole: "ZAR 1,240". */
export function moneyWords(amount: number, currency: string): string {
  return `${currency} ${whole(Math.round(amount))}`;
}

// ── natural language ─────────────────────────────────────────────────────────

/** The ledger filter a matched phrase fills, in words. */
export function slotWord(slot: string): string {
  switch (slot) {
    case "module":
      return t("Object");
    case "severity":
      return t("Severity");
    case "status":
      return t("Status");
    case "due":
      return t("Due");
    case "assigned":
      return t("Owner");
    case "proposed":
      return t("Suggested value");
    case "system":
      return t("System");
    case "policy":
      return t("Policy");
    case "check_id":
      return t("Rule");
    default:
      return slot;
  }
}

/** The command line's natural language mode: a leading `?` and at least one word after it. */
export function nlQuestion(input: string): string | null {
  const s = input.trimStart();
  if (!s.startsWith("?")) return null;
  const q = s.slice(1).trim();
  return q || null;
}

/** The server's href is the ledger of the old address (/v2/work); the interface lives at the root now. */
export function nlHref(href: string): string {
  return href.startsWith("/v2/") ? href.slice(3) : href === "/v2" ? "/" : href;
}

/**
 * Where Open goes: the server's href at the root, and `filter=open` when the sentence named no status, so the ledger
 * lists every open state as the explanation says ("Open work only") rather than its default of rows to fix.
 */
export function nlTarget(a: { href: string; filter: Record<string, string | boolean> }): string {
  const base = nlHref(a.href);
  if ("status" in a.filter || "proposed" in a.filter) return base;
  return `${base}${base.includes("?") ? "&" : "?"}filter=open`;
}

/** A matched value as the chip shows it: true reads as "yes". */
export const matchValue = (m: Pick<NlMatch, "value">): string => (m.value === true ? t("yes") : m.value === false ? t("no") : String(m.value));

// ── history ──────────────────────────────────────────────────────────────────

/** One event of a record's history in words: what happened, without who and when (shown beside it). */
export function eventWords(e: HistoryEvent): string {
  const rule = e.check_id ? `${e.check_id}: ` : "";
  const value = e.to_value ? t(" to {value}", { value: e.to_value }) : "";
  if (e.kind === "fix_proposed") return t("{rule}fix proposed{value}", { rule, value });
  if (e.kind === "fix_approved") return t("{rule}fix approved{value}", { rule, value });
  if (e.kind === "fix_sent") return t("{rule}fix sent to SAP{value}", { rule, value });
  if (e.kind === "batch") return t("{rule}fix batch {status}", { rule, status: e.batch_status ?? e.action ?? "" });
  if (e.action === "opened") return t("{rule}started failing", { rule });
  if (e.action === "assign") return e.to_value ? t("{rule}assigned to {who}", { rule, who: e.to_value }) : t("{rule}unassigned", { rule });
  if (e.action === "comment") return t("{rule}comment: {note}", { rule, note: e.note ?? "" });
  if (e.action === "status") return t("{rule}status set{value}", { rule, value });
  return `${rule}${e.action ?? e.kind}${value}`;
}

// ── digests ──────────────────────────────────────────────────────────────────

export const CHANNEL_WORD: Record<DigestChannel, string> = { get email() { return t("Email"); }, get webhook() { return t("Webhooks"); }, get alert_channel() { return t("Alert channel"); } };

/** Who a digest is for: "Role: Programme lead / CIO" or "Wave: Wave 2: master data". */
export function audienceWords(d: Pick<Digest, "audience" | "role" | "wave_id">, roleName: (r: string) => string, waveName: (w: string) => string | null): string {
  if (d.audience === "role") return t("Role: {role}", { role: d.role ? roleName(d.role) : "—" });
  return t("Wave: {wave}", { wave: d.wave_id ? (waveName(d.wave_id) ?? d.wave_id) : "—" });
}

/** A delivery's state as a word. */
export function deliveryWord(status: string): string {
  switch (status) {
    case "sent":
      return t("Sent");
    case "partial":
      return t("Partly sent");
    case "failed":
      return t("Failed");
    case "skipped":
      return t("Held back");
    case "running":
    case "sending":
      return t("Sending");
    default:
      return status;
  }
}

/** The tone of a delivery's mark. */
export const deliveryTone = (status: string): "go" | "at-risk" | "no-go" | null => (status === "sent" ? "go" : status === "partial" || status === "skipped" ? "at-risk" : status === "failed" ? "no-go" : null);

/** Emails typed one per line or separated by commas, trimmed and without repeats. */
export function emailsFrom(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean))];
}

/** True for a plausible email address, as the API checks it. */
export const emailOk = (s: string): boolean => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

/** True for an IANA zone name the browser knows (Africa/Johannesburg, UTC). */
export function zoneOk(zone: string): boolean {
  if (!zone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone.trim() });
    return true;
  } catch {
    return false;
  }
}

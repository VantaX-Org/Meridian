import { MODULE_LABELS, formatModuleName, humanizeIds } from "@/lib/format";
import type { Notification } from "@/types/api";

/**
 * Notification words. The backend writes title and body for logs and email (`workers/tasks/send_notifications.py`,
 * `workers/scheduler.py`, `workers/tasks/run_checks.py`); the app shows them as sentences with object names, never
 * "module(s)", object ids or "threshold 1" shorthand. A notification links to what it is about: its own link when it
 * carries one, else the page of its type.
 */

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${n === 1 ? word : `${word}s`}`;

/** Lower-case object ids ("controlling", "hcm") read as their names; other text is left alone. */
function nameObjects(text: string): string {
  return text.replace(/\b[a-z][a-z0-9]*\b/g, (w) => (Object.hasOwn(MODULE_LABELS, w) ? formatModuleName(w) : w));
}

/** "1 module(s)" -> "1 object", "3 record(s)" -> "3 records"; the platform says object, never module. */
function agree(text: string): string {
  return text.replace(/(\d[\d,]*) (\w+)\(s\)/g, (_m, n: string, w: string) => {
    const count = Number(n.replace(/,/g, ""));
    const word = w === "module" ? "object" : w;
    return `${n} ${count === 1 ? word : `${word}s`}`;
  });
}

const clean = (text: string) => nameObjects(humanizeIds(agree(text)));

/** One threshold breach message as a sentence ("2 critical rules are failing, over your limit of 1"). */
function breachSentence(message: string): string {
  const failing = /^(\d+) (critical|high) checks failing \(threshold (\d+)\)$/.exec(message);
  if (failing) {
    const n = Number(failing[1]);
    return `${n} ${failing[2]} ${n === 1 ? "rule is" : "rules are"} failing, over your limit of ${failing[3]}`;
  }
  const fell = /^(\w+): DQS fell ([\d.]+) points to ([\d.]+) \(threshold ([\d.]+)\)$/.exec(message);
  if (fell) return `${formatModuleName(fell[1])}: score fell ${fell[2]} points to ${fell[3]}, over your limit of ${fell[4]}`;
  const floor = /^(\w+): DQS ([\d.]+) is below its floor of ([\d.]+)$/.exec(message);
  if (floor) return `${formatModuleName(floor[1])}: score ${floor[2]} is below its floor of ${floor[3]}`;
  return clean(message);
}

/** The notification's headline as plain words. */
export function notificationTitle(n: Pick<Notification, "type" | "title">): string {
  if (n.type === "dq_alert") {
    const many = /^DQ alert\s*[—-]\s*(\d+) thresholds? crossed.*$/.exec(n.title);
    if (many) return `${plural(Number(many[1]), "quality limit")} ${Number(many[1]) === 1 ? "was" : "were"} crossed`;
    const one = /^DQ alert\s*[—-]\s*(.+)$/.exec(n.title);
    if (one) return `${breachSentence(one[1])}`.replace(/^./, (c) => c.toUpperCase());
  }
  return clean(n.title);
}

export interface NotificationLine {
  text: string;
  /** In-app page the line is about. */
  href?: string;
}

const SEVERITY_WORD: Record<string, string> = { critical: "critical", high: "high", medium: "medium", low: "low" };

/** "Clean: hcm — 57" -> "Clean Human capital management record 57"; "MM045: material_master" -> "Fix rule MM045 on Material master". */
function nextActionTitle(title: string): string {
  const cleaning = /^Clean: (\S+) — (.+)$/.exec(title);
  if (cleaning) {
    const record = cleaning[2].split("|")[0];
    return `Clean ${formatModuleName(cleaning[1])} record ${record}`;
  }
  const rule = /^([A-Za-z]{1,6}\d+): (\w+)$/.exec(title);
  if (rule) return `Fix rule ${rule[1]} on ${formatModuleName(rule[2])}`;
  return clean(title);
}

/** One line of a daily digest as a sentence with the page it is about. */
export function digestLine(line: string): NotificationLine {
  const counts = /^(\d+) new findings, (\d+) cleaning items, (\d+) exceptions$/.exec(line);
  if (counts) {
    return { text: `Since the last digest: ${plural(Number(counts[1]), "new rule failure")}, ${plural(Number(counts[2]), "cleaning item")} and ${plural(Number(counts[3]), "exception")}.`, href: "/inbox" };
  }
  const next = /^Next: (.+) \((\w+), (\d+) records?\)$/.exec(line);
  if (next) {
    const records = Number(next[3]);
    return { text: `Next step: ${nextActionTitle(next[1])}, ${SEVERITY_WORD[next[2]] ?? next[2]} priority, ${plural(records, "record")}.`, href: "/fix" };
  }
  const warnings = /^(\d+) early warning\(s\) on DQS forecasts$/.exec(line);
  if (warnings) return { text: `${plural(Number(warnings[1]), "early warning")} on score forecasts.`, href: "/insights/trends" };
  const text = clean(line);
  return { text: /[.!?]$/.test(text) ? text : `${text}.` };
}

/** The sentences of a notification's body: one per line for a digest or alert, else the body cleaned up. */
export function notificationLines(n: Pick<Notification, "type" | "body">): NotificationLine[] {
  const lines = n.body.split("\n").map((l) => l.trim()).filter(Boolean);
  if (n.type === "daily_digest" || n.type === "digest") return lines.map(digestLine);
  if (n.type === "dq_alert") return lines.map((l) => ({ text: `${breachSentence(l)}.` }));
  return lines.map((l) => ({ text: clean(l) }));
}

/** Where a notification opens when it has no link of its own, by type. */
const TYPE_TARGET: Partial<Record<Notification["type"], string>> = {
  daily_digest: "/inbox",
  digest: "/inbox",
  finding: "/runs",
  monitor: "/runs",
  dq_alert: "/runs",
  cleaning: "/fix",
  exception: "/inbox",
  approval: "/inbox",
  rule_proposal: "/rules",
  report: "/insights/reports",
  sla_at_risk: "/inbox",
  sla_ack_breached: "/inbox",
  sla_breached: "/inbox",
};

/** Only in-app paths are followed: a notification never sends the user off the customer's own host. */
export function notificationTarget(n: Pick<Notification, "type" | "link">): string | null {
  const own = n.link && n.link.startsWith("/") && !n.link.startsWith("//") ? n.link : null;
  return own ?? TYPE_TARGET[n.type] ?? null;
}

export type NotificationGroup = { n: Notification; count: number; ids: string[] };

/**
 * Exact duplicates from the same run (same type, title, body and target, raised within ten minutes of the first)
 * collapse into one entry with a count. The first (newest) one stands for the group; all its ids are kept so reading
 * the entry reads them all.
 */
export function collapseNotifications(items: readonly Notification[]): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  const open = new Map<string, NotificationGroup>();
  for (const n of items) {
    const key = [n.type, n.title, n.body, n.link ?? ""].join("\u0000");
    const g = open.get(key);
    if (g && Math.abs(Date.parse(g.n.created_at) - Date.parse(n.created_at)) <= 10 * 60_000) {
      g.count += 1;
      g.ids.push(n.id);
      if (!n.is_read && g.n.is_read) g.n = { ...g.n, is_read: false };
      continue;
    }
    const fresh = { n, count: 1, ids: [n.id] };
    groups.push(fresh);
    open.set(key, fresh);
  }
  return groups;
}

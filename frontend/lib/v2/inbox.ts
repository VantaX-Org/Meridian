/**
 * The inbox panel's pure parts: which notifications are from today, the mark and word of each kind, and where a
 * notification's link goes.
 */
import type { Notification } from "@/types/api";
import type { SeverityKey } from "@/design/v2/marks";

export interface NotificationGroups {
  today: Notification[];
  earlier: Notification[];
}

const sameDay = (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Today and Earlier, each newest first. "Today" is the viewer's own calendar day. */
export function groupNotifications(items: readonly Notification[], now: Date = new Date()): NotificationGroups {
  const sorted = [...items].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const today: Notification[] = [];
  const earlier: Notification[] = [];
  for (const it of sorted) (sameDay(new Date(it.created_at), now) ? today : earlier).push(it);
  return { today, earlier };
}

export interface KindMark {
  word: string;
  /** The shape of the mark, from the same set the ledger uses for severity. */
  severity: SeverityKey;
}

const KIND: Record<string, KindMark> = {
  sla_breached: { word: "SLA breached", severity: "critical" },
  sla_ack_breached: { word: "SLA breached", severity: "critical" },
  sla_at_risk: { word: "SLA at risk", severity: "high" },
  dq_alert: { word: "Data quality", severity: "high" },
  warning: { word: "Warning", severity: "high" },
  approval: { word: "Approval", severity: "medium" },
  exception: { word: "Exception", severity: "medium" },
  rule_proposal: { word: "Rule", severity: "medium" },
  monitor: { word: "Monitor", severity: "low" },
  finding: { word: "Finding", severity: "low" },
  cleaning: { word: "Cleaning", severity: "low" },
  digest: { word: "Digest", severity: "low" },
  daily_digest: { word: "Digest", severity: "low" },
  report: { word: "Report", severity: "low" },
  info: { word: "Notice", severity: "low" },
};

export const kindOf = (type: string): KindMark => KIND[type] ?? { word: "Notice", severity: "low" };

/** The sentence: the title, and the body after it when it adds something. */
export function sentenceOf(n: Pick<Notification, "title" | "body">): string {
  const title = n.title.trim();
  const body = (n.body ?? "").trim();
  if (!body || body === title) return title;
  return `${title.replace(/[.:]$/, "")}. ${body}`;
}

export interface NotificationLink {
  href: string;
  label: string;
  /** A page of the current interface: opened as a plain link, not through the v2 router. */
  external: boolean;
}

/**
 * Where "open" goes. A link into the v2 interface keeps its place; one into an object names the object; any other
 * link is a page of the current interface.
 */
export function linkOf(link: string | null | undefined, objectLabel?: (module: string) => string | null): NotificationLink | null {
  if (!link) return null;
  const external = !/^\/v2(?:[/?#]|$)/.test(link);
  const obj = /^\/v2\/o\/[^/]+\/([^/?#]+)/.exec(link);
  if (obj) {
    const id = decodeURIComponent(obj[1]).replace(/-/g, "_");
    const label = objectLabel?.(id) ?? id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
    return { href: link, label, external };
  }
  if (/[?&]open=batch:/.test(link)) return { href: link, label: "Open the batch", external };
  if (/^\/v2\/work/.test(link)) return { href: link, label: "Open the ledger", external };
  return { href: link, label: "Open", external };
}

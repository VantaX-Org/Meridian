/**
 * The inbox panel's pure parts: which notifications are from today, the mark and word of each kind, and where a
 * notification's link goes.
 */
import type { Notification } from "@/types/api";
import type { SeverityKey } from "@/design/v2/marks";
import { t } from "@/lib/v2/i18n";

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
  sla_breached: { get word() { return t("SLA breached"); }, severity: "critical" },
  sla_ack_breached: { get word() { return t("SLA breached"); }, severity: "critical" },
  sla_at_risk: { get word() { return t("SLA at risk"); }, severity: "high" },
  dq_alert: { get word() { return t("Data quality"); }, severity: "high" },
  warning: { get word() { return t("Warning"); }, severity: "high" },
  approval: { get word() { return t("Approval"); }, severity: "medium" },
  exception: { get word() { return t("Exception"); }, severity: "medium" },
  rule_proposal: { get word() { return t("Rule"); }, severity: "medium" },
  monitor: { get word() { return t("Monitor"); }, severity: "low" },
  finding: { get word() { return t("Finding"); }, severity: "low" },
  cleaning: { get word() { return t("Cleaning"); }, severity: "low" },
  digest: { get word() { return t("Digest"); }, severity: "low" },
  daily_digest: { get word() { return t("Digest"); }, severity: "low" },
  report: { get word() { return t("Report"); }, severity: "low" },
  info: { get word() { return t("Notice"); }, severity: "low" },
  config_drift: { get word() { return t("Configuration"); }, severity: "medium" },
};

export const kindOf = (type: string): KindMark => KIND[type] ?? { word: t("Notice"), severity: "low" };

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
  if (/[?&]open=batch:/.test(link)) return { href: link, label: t("Open the batch"), external };
  if (/^\/v2\/work/.test(link)) return { href: link, label: t("Open the ledger"), external };
  return { href: link, label: t("Open"), external };
}

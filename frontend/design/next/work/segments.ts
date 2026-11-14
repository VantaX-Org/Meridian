import { t } from "@/lib/v2/i18n";

/**
 * The segments of Work, in order. `slug` is the path after /next/work; the first segment is the landing ledger.
 * Deeper pages hang off a segment and keep its tab selected.
 */
export interface Segment {
  id: string;
  slug: string;
  label: () => string;
}

export const WORK_SEGMENTS: readonly Segment[] = [
  { id: "ledger", slug: "", label: () => t("Ledger") },
  { id: "approvals", slug: "approvals", label: () => t("Approvals") },
  { id: "drafts", slug: "drafts", label: () => t("Fix drafts") },
  { id: "requests", slug: "requests", label: () => t("Requests") },
  { id: "triage", slug: "triage", label: () => t("Triage") },
  { id: "exceptions", slug: "exceptions", label: () => t("Exceptions") },
  { id: "monitor", slug: "monitor", label: () => t("Monitor") },
  { id: "analytics", slug: "analytics", label: () => t("Analytics") },
];

/** Pages that live under a segment's tab without a tab of their own. */
export const DEEP_SEGMENTS: ReadonlyArray<{ slug: string; parent: string }> = [
  { slug: "requests/new", parent: "requests" },
  { slug: "requests/analytics", parent: "requests" },
];

export function segmentOf(slug: string[] | undefined): { id: string; deep: string | null } | null {
  const key = (slug ?? []).join("/");
  const deep = DEEP_SEGMENTS.find((d) => d.slug === key);
  if (deep) return { id: deep.parent, deep: deep.slug };
  const seg = WORK_SEGMENTS.find((s) => s.slug === key);
  return seg ? { id: seg.id, deep: null } : null;
}

export const WORK_BASE = "/next/work";
export const segmentHref = (s: Segment): string => (s.slug ? `${WORK_BASE}/${s.slug}` : WORK_BASE);

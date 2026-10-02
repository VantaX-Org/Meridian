"use client";

/**
 * Command Centre → Notifications: what the platform wants a person to know —
 * findings, approvals, cleaning outcomes, digests and warnings. Opening one
 * marks it read; the link takes you to the thing itself.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banner, Button, Chip, EmptyState, KpiRail, Stack, Stat, Text, type ChipTone } from "@/components/aurora";
import { useUrlState } from "@/hooks/use-url-state";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/api/notifications";
import { relativeTime } from "@/lib/format";
import type { NotificationType } from "@/types/api";

const TYPES: NotificationType[] = ["finding", "approval", "cleaning", "exception", "digest", "warning"];
const TONE: Record<NotificationType, ChipTone> = { finding: "info", approval: "warning", cleaning: "success", exception: "neutral", digest: "neutral", warning: "danger" };

export function NotificationsSurface() {
  const qc = useQueryClient();
  const [view, setView] = useUrlState("view", "all");
  const q = useQuery({
    queryKey: ["notifications.list", view],
    queryFn: () => getNotifications({ limit: 100, ...(view === "unread" ? { is_read: false } : view !== "all" ? { type: view } : {}) }),
  });
  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const unread = items.filter((n) => !n.is_read).length;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["notifications.list"] }); qc.invalidateQueries({ queryKey: ["notifications-unread-count"] }); };
  const markOne = useMutation({ mutationFn: markNotificationRead, onSuccess: refresh });
  const markAll = useMutation({ mutationFn: markAllNotificationsRead, onSuccess: refresh });
  const byType = TYPES.map((t) => [t, items.filter((n) => n.type === t).length] as const);

  return (
    <Stack gap={5} className="aurora-page">
      <KpiRail>
        <Stat label="Notifications" value={q.data?.total ?? items.length} />
        <Stat label="Unread" value={unread} tone={unread ? "info" : "neutral"} />
        <Stat label="Warnings" value={items.filter((n) => n.type === "warning").length} tone={items.some((n) => n.type === "warning" && !n.is_read) ? "danger" : "neutral"} />
        <Stat label="Awaiting approval" value={items.filter((n) => n.type === "approval" && !n.is_read).length} tone={items.some((n) => n.type === "approval" && !n.is_read) ? "warning" : "neutral"} />
      </KpiRail>
      <Stack direction="row" gap={2} wrap align="center">
        <Chip selected={view === "all"} onClick={() => setView("all")}>All</Chip>
        <Chip selected={view === "unread"} onClick={() => setView("unread")}>Unread · {unread}</Chip>
        {byType.map(([t, n]) => <Chip key={t} selected={view === t} onClick={() => setView(t)}>{t} · {n}</Chip>)}
        <span style={{ flex: 1 }} />
        <Button variant="secondary" size="sm" onClick={() => markAll.mutate()} disabled={markAll.isPending || !unread}>Mark all read</Button>
      </Stack>
      {q.isLoading ? <Text tone="muted">Reading notifications.</Text>
        : q.error ? <Banner tone="danger" title="Notifications could not be read">{(q.error as Error).message}</Banner>
        : items.length ? (
          <ul className="aurora-notifs" aria-label="Notifications">
            {items.map((n) => (
              <li key={n.id} className="aurora-notifs__row" data-unread={!n.is_read}>
                <span className="aurora-notifs__dot" aria-hidden="true" />
                <Chip tone={TONE[n.type] ?? "neutral"}>{n.type}</Chip>
                <button type="button" className="aurora-notifs__body" onClick={() => !n.is_read && markOne.mutate(n.id)} aria-label={n.is_read ? n.title : `${n.title} (unread; mark read)`}>
                  <Text variant="text-body" as="span"><strong>{n.title}</strong></Text>
                  <Text variant="text-small" tone="secondary" as="span">{n.body}</Text>
                </button>
                <Text variant="text-micro" tone="muted" className="aurora-number">{relativeTime(n.created_at)}</Text>
                {n.link ? <Link href={n.link} className="aurora-link" onClick={() => !n.is_read && markOne.mutate(n.id)}>Open →</Link> : null}
              </li>
            ))}
          </ul>
        ) : <EmptyState title={view === "all" ? "Nothing to tell you yet." : "Nothing in this view."} body="Findings above your alert thresholds, approvals waiting on you and run digests arrive here." />}
    </Stack>
  );
}

"use client";

/**
 * Notifications: what the platform wants a person to know, grouped by day.
 * Findings, approvals, cleaning outcomes, digests and warnings. Opening one
 * marks it read; the link takes you to the thing itself.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Chip } from "@/components/aurora";
import { Banner, Button, EmptyState, PageHeader, SectionCard, TableSkeleton, Verdict } from "@/components/ui-core";
import { useUrlState } from "@/hooks/use-url-state";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "@/lib/api/notifications";
import { relativeTime, formatDate, humanizeIds } from "@/lib/format";
import type { Notification, NotificationType } from "@/types/api";

const TYPES: NotificationType[] = ["finding", "approval", "cleaning", "exception", "digest", "warning"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const dayLabel = (iso: string) => formatDate(iso);

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

  const days = useMemo(() => {
    const m = new Map<string, Notification[]>();
    for (const n of items) {
      const k = dayLabel(n.created_at);
      m.set(k, [...(m.get(k) ?? []), n]);
    }
    return [...m.entries()];
  }, [items]);

  const verdict = q.isLoading || q.error ? null
    : unread ? `${unread.toLocaleString()} unread ${unread === 1 ? "notification is" : "notifications are"} waiting for you.`
    : "You have read everything.";

  return (
    <div className="ui-page">
      <PageHeader title="Notifications" summary="Alerts and job results addressed to you." />
      {verdict ? <Verdict>{verdict}</Verdict> : null}
      <div className="aurora-notifs__bar">
        <Chip selected={view === "all"} onClick={() => setView("all")}>All</Chip>
        <Chip selected={view === "unread"} onClick={() => setView("unread")}>Unread</Chip>
        {TYPES.map((t) => <Chip key={t} selected={view === t} onClick={() => setView(t)}>{cap(t)}</Chip>)}
        <span className="aurora-notifs__spacer" />
        <Button variant="secondary" onClick={() => markAll.mutate()} disabled={markAll.isPending || !unread}>Mark all read</Button>
      </div>

      {q.isLoading ? <TableSkeleton rows={6} label="Reading notifications" />
        : q.error ? <Banner tone="danger" title="Notifications could not be read">{(q.error as Error).message}</Banner>
        : days.length ? days.map(([day, list]) => (
          <SectionCard key={day} title={day} meta={list.length} flush>
            <ul className="aurora-notifs" aria-label={day}>
              {list.map((n) => (
                <li key={n.id} className="aurora-notifs__row" data-unread={!n.is_read}>
                  <span className="aurora-notifs__dot" aria-hidden="true" />
                  <button type="button" className="aurora-notifs__body" onClick={() => !n.is_read && markOne.mutate(n.id)}
                    aria-label={n.is_read ? humanizeIds(n.title) : `${humanizeIds(n.title)}, unread. Mark read.`}>
                    <span className="aurora-notifs__title">{humanizeIds(n.title)}</span>
                    <span className="aurora-notifs__text">{humanizeIds(n.body)}</span>
                  </button>
                  <span className="aurora-notifs__kind">{cap(n.type)}</span>
                  <span className="aurora-notifs__when aurora-number">{relativeTime(n.created_at)}</span>
                  {n.link ? <Link href={n.link} className="ui-link" onClick={() => !n.is_read && markOne.mutate(n.id)}>Open</Link> : <span />}
                </li>
              ))}
            </ul>
          </SectionCard>
        )) : (
          <EmptyState>{view === "all" ? "Nothing to tell you yet. Findings above your alert thresholds, approvals waiting on you and run digests arrive here." : "Nothing in this view."}</EmptyState>
        )}
    </div>
  );
}

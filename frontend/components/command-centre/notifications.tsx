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
type Group = { n: Notification; count: number; since: string; unread: boolean; unreadIds: string[] };

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

  // Same title on the same day is one row: the newest, with a count and the oldest time.
  const days = useMemo(() => {
    const m = new Map<string, Map<string, Group>>();
    for (const n of [...items].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
      const day = dayLabel(n.created_at);
      const byTitle = m.get(day) ?? new Map<string, Group>();
      const g = byTitle.get(n.title);
      if (g) { g.count += 1; g.since = n.created_at; g.unread ||= !n.is_read; if (!n.is_read) g.unreadIds.push(n.id); }
      else byTitle.set(n.title, { n, count: 1, since: n.created_at, unread: !n.is_read, unreadIds: n.is_read ? [] : [n.id] });
      m.set(day, byTitle);
    }
    return [...m.entries()].map(([day, g]) => [day, [...g.values()]] as const);
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
          <SectionCard key={day} title={day} meta={list.reduce((a, g) => a + g.count, 0)} flush>
            <ul className="aurora-notifs" aria-label={day}>
              {list.map(({ n, count, since, unread: isUnread, unreadIds }) => {
                const title = count > 1 ? `${humanizeIds(n.title)} — ${count} times since ${relativeTime(since)}` : humanizeIds(n.title);
                const readAll = () => unreadIds.forEach((id) => markOne.mutate(id));
                const row = (
                  <>
                    <span className="aurora-notifs__body">
                      <span className="aurora-notifs__title">{title}</span>
                      <span className="aurora-notifs__text">{humanizeIds(n.body)}</span>
                    </span>
                    <span className="aurora-notifs__kind">{cap(n.type)}</span>
                    <span className="aurora-notifs__when aurora-number">{relativeTime(n.created_at)}</span>
                  </>
                );
                return (
                  <li key={n.id} className="aurora-notifs__row" data-unread={isUnread}>
                    <span className="aurora-notifs__dot" aria-hidden="true" />
                    {n.link
                      ? <Link href={n.link} className="aurora-notifs__link" onClick={readAll} aria-label={`${title}${isUnread ? ", unread" : ""}. Open.`}>{row}</Link>
                      : <button type="button" className="aurora-notifs__link" onClick={readAll} aria-label={isUnread ? `${title}, unread. Mark read.` : title}>{row}</button>}
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        )) : (
          <EmptyState>{view === "all" ? "Nothing to tell you yet. Findings above your alert thresholds, approvals waiting on you and run digests arrive here." : "Nothing in this view."}</EmptyState>
        )}
    </div>
  );
}

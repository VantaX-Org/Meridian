"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Popover } from "@base-ui/react/popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useJobs } from "../../hooks/use-jobs";
import { getNotifications, getUnreadCount, markAllNotificationsRead, markNotificationRead } from "../../lib/api/notifications";
import { humanizeIds, relativeTime } from "../../lib/format";
import { notificationLines, notificationTarget, notificationTitle } from "../../lib/notification-copy";
import { queryKeys } from "../../lib/query-keys";
import type { Notification, NotificationType } from "../../types/api";
import { Badge } from "../primitives/Badge";
import { Button } from "../primitives/Button";
import { IconButton } from "../primitives/IconButton";
import { Pill, type PillTone } from "../primitives/Pill";
import { Skeleton } from "../primitives/Skeleton";
import { IconBell } from "../icons";
import { toast } from "./Toaster";
import { apiErrorMessage } from "../../lib/error";

/** Pill tone per notification type: warnings read as at-risk, approvals as info, everything else neutral. */
const TONE: Record<NotificationType, PillTone> = {
  finding: "neutral",
  cleaning: "neutral",
  exception: "neutral",
  approval: "info",
  digest: "neutral",
  warning: "at-risk",
  monitor: "at-risk",
  daily_digest: "neutral",
  report: "info",
  dq_alert: "at-risk",
  rule_proposal: "info",
  info: "neutral",
  sla_at_risk: "at-risk",
  sla_ack_breached: "no-go",
  sla_breached: "no-go",
};

export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  finding: "Finding",
  cleaning: "Cleaning",
  exception: "Exception",
  approval: "Approval",
  digest: "Digest",
  warning: "Warning",
  // The stored type string stays `monitor`; people read it as a regression (a score that fell between runs).
  monitor: "Regression",
  daily_digest: "Daily digest",
  report: "Report",
  dq_alert: "Quality alert",
  rule_proposal: "Rule proposal",
  info: "Info",
  sla_at_risk: "SLA at risk",
  sla_ack_breached: "SLA not acknowledged",
  sla_breached: "SLA breached",
};

/** Only in-app paths are followed: a notification never sends the user off the customer's own host. */
export function internalHref(link: string | null): string | null {
  return link && link.startsWith("/") && !link.startsWith("//") ? link : null;
}

/** Invalidates everything the bell and the notifications page read. */
export function useNotificationMutations() {
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.unreadNotifications() });
    void qc.invalidateQueries({ queryKey: ["inbox", "notifications"] });
  };
  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: refresh,
    onError: (e) => toast.error("Could not mark the notification read", { description: apiErrorMessage(e) }),
  });
  const markAllRead = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: refresh,
    onError: (e) => toast.error("Could not mark the notifications read", { description: apiErrorMessage(e) }),
  });
  return { markRead, markAllRead };
}

/** One notification: unread dot, type pill, title (a link when it has an in-app target), body and age. */
export function NotificationRow({ n, showBody, count = 1, onOpen, onMarkRead }: {
  n: Notification; showBody?: boolean; onOpen: (n: Notification) => void;
  /** How many identical notifications from the same run this row stands for. */
  count?: number;
  /** Marks this one read without opening it; the row shows "Mark read" while it is unread. */
  onMarkRead?: (n: Notification) => void;
}) {
  const href = notificationTarget(n);
  const titleText = notificationTitle(n);
  const lines = showBody ? notificationLines(n) : [];
  const title = <span className="m-text-body font-medium m-ink">{titleText}</span>;
  return (
    <li className="flex items-start gap-3 px-3 py-2" data-unread={n.is_read ? undefined : "true"}>
      <span
        aria-hidden="true"
        className="mt-1.5 shrink-0 rounded-full"
        style={{ width: 6, height: 6, background: n.is_read ? "transparent" : "var(--m-accent)" }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Pill tone={TONE[n.type] ?? "neutral"}>{NOTIFICATION_TYPE_LABEL[n.type] ?? humanizeIds(n.type)}</Pill>
          {!n.is_read && <span className="sr-only">Unread</span>}
          <time className="m-text-meta m-ink-3" dateTime={n.created_at}>{relativeTime(n.created_at)}</time>
          {count > 1 && <span className="m-text-meta m-ink-3">{`${count} times`}</span>}
        </div>
        {href ? (
          <Link href={href} onClick={() => onOpen(n)} aria-label={`Open notification: ${titleText}`} className="underline-offset-2 hover:underline">{title}</Link>
        ) : (
          <button type="button" onClick={() => onOpen(n)} aria-label={`Open notification: ${titleText}`} className="text-left">{title}</button>
        )}
        {showBody && (
          <ul className="flex flex-col gap-0.5">
            {lines.map((line, i) => (
              <li key={i} className="m-text-body m-ink-2">
                {line.text}
                {line.href && <>{" "}<Link href={line.href} onClick={() => onOpen(n)} className="m-ink-accent-ink underline underline-offset-2">Open</Link></>}
              </li>
            ))}
          </ul>
        )}
        {showBody && href && !lines.some((l) => l.href) && (
          <Link href={href} onClick={() => onOpen(n)} className="m-text-body font-medium m-ink-accent-ink underline-offset-2 hover:underline">Open</Link>
        )}
      </div>
      {onMarkRead && !n.is_read && (
        <Button variant="ghost" size="sm" onClick={() => onMarkRead(n)} aria-label={`Mark read: ${titleText}`}>Mark read</Button>
      )}
    </li>
  );
}

/**
 * Top-bar bell. The unread count polls every 60 s and refetches when a job completes; the popover lists the
 * latest ten. Opening a notification marks it read; "Open all" goes to /inbox/notifications.
 */
export function NotificationBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const count = useQuery({ queryKey: queryKeys.unreadNotifications(), queryFn: getUnreadCount, refetchInterval: 60_000, staleTime: 30_000 });
  const list = useQuery({ queryKey: queryKeys.notifications({ limit: 10 }), queryFn: () => getNotifications({ limit: 10 }), enabled: open });
  const { markRead, markAllRead } = useNotificationMutations();

  // A finished job usually raises a notification; refetch the count when the number of completed jobs grows.
  const { jobs } = useJobs();
  const completed = jobs.filter((j) => j.status === "completed").length;
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (seen.current !== null && completed > seen.current) {
      void qc.invalidateQueries({ queryKey: queryKeys.unreadNotifications() });
      void qc.invalidateQueries({ queryKey: ["inbox", "notifications"] });
    }
    seen.current = completed;
  }, [completed, qc]);

  const unread = count.data ?? 0;
  const items = list.data?.items ?? [];
  const onOpen = (n: Notification) => {
    if (!n.is_read) markRead.mutate(n.id);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div style={{ position: "relative" }}>
        <Popover.Trigger render={<IconButton aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} />}>
          <IconBell size={16} />
        </Popover.Trigger>
        {unread > 0 && (
          <span aria-hidden="true" className="pointer-events-none absolute" style={{ top: -4, right: -4 }}>
            <Badge count={unread} />
          </span>
        )}
      </div>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
          <Popover.Popup className="m-popup flex flex-col" style={{ width: 380, maxWidth: "calc(100vw - 32px)", padding: 0 }} aria-label="Notifications">
            <div className="flex items-center justify-between gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--m-line)" }}>
              <span className="m-text-h font-semibold m-ink">Notifications</span>
              <Button variant="ghost" disabled={unread === 0} pending={markAllRead.isPending} onClick={() => markAllRead.mutate()}>Mark all read</Button>
            </div>
            <div className="overflow-auto" style={{ maxHeight: 420 }}>
              {list.isLoading ? (
                <div className="flex flex-col gap-2 p-3" data-state="loading">
                  {[0, 1, 2].map((i) => <Skeleton key={i} height={40} />)}
                </div>
              ) : list.isError ? (
                <div className="flex items-center justify-between gap-2 p-3">
                  <span className="m-text-body m-ink-2">Notifications did not load</span>
                  <Button variant="secondary" onClick={() => void list.refetch()}>Retry</Button>
                </div>
              ) : items.length === 0 ? (
                <p className="m-text-body p-3 m-ink-3">You are all caught up</p>
              ) : (
                <ul>{items.map((n) => <NotificationRow key={n.id} n={n} onOpen={onOpen} onMarkRead={(x) => markRead.mutate(x.id)} />)}</ul>
              )}
            </div>
            <div className="px-3 py-2" style={{ borderTop: "1px solid var(--m-line)" }}>
              <Link href="/inbox/notifications" onClick={() => setOpen(false)} className="m-text-body font-medium m-ink-accent-ink">Open all</Link>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

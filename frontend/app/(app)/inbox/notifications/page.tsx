"use client";

/** Inbox › Notifications: every in-app notification, filterable by type and unread. The bell shows the latest ten. */

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button, Card, ExplorerPage, PageHeader, Select, Switch, NotificationRow, NOTIFICATION_TYPE_LABEL, useNotificationMutations, asyncStateOf } from "@/design";
import { oneOf, useUrlState } from "@/hooks/use-url-state";
import { getNotifications, getUnreadCount } from "@/lib/api/notifications";
import { collapseNotifications } from "@/lib/notification-copy";
import { queryKeys } from "@/lib/query-keys";
import type { Notification, NotificationType } from "@/types/api";

const PAGE = 50;
const TYPES = Object.keys(NOTIFICATION_TYPE_LABEL) as NotificationType[];
const TYPE_OPTIONS = [{ value: "all", label: "All types" }, ...TYPES.map((t) => ({ value: t, label: NOTIFICATION_TYPE_LABEL[t] }))];

export default function NotificationsPage() {
  const [rawType, setType] = useUrlState("type", "all");
  const [rawUnread, setUnread] = useUrlState("unread", "");
  const type = oneOf(rawType, ["all", ...TYPES] as const, "all");
  const unreadOnly = rawUnread === "1";
  const [limit, setLimit] = useState(PAGE);
  const filters = { type: type === "all" ? undefined : type, is_read: unreadOnly ? false : undefined, limit };
  const q = useQuery({ queryKey: queryKeys.notifications(filters), queryFn: () => getNotifications(filters), placeholderData: keepPreviousData });
  const unread = useQuery({ queryKey: queryKeys.unreadNotifications(), queryFn: getUnreadCount, refetchInterval: 60_000, staleTime: 30_000 });
  const { markRead, markAllRead } = useNotificationMutations();

  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const total = q.data?.total ?? 0;
  const filtering = type !== "all" || unreadOnly;
  // Identical notifications from one run read as one entry with a count; reading it reads them all.
  const groups = useMemo(() => collapseNotifications(items), [items]);
  const idsOf = (n: Notification) => groups.find((g) => g.n.id === n.id)?.ids ?? [n.id];
  const readAll = (n: Notification) => {
    const unreadIds = idsOf(n).filter((id) => items.find((i) => i.id === id)?.is_read === false);
    for (const id of unreadIds.length ? unreadIds : n.is_read ? [] : [n.id]) markRead.mutate(id);
  };
  const onOpen = (n: Notification) => {
    if (!n.is_read) readAll(n);
  };

  return (
    <ExplorerPage
      header={
        <PageHeader
          title="Notifications"
          meta={`${q.isLoading ? "" : `${total.toLocaleString()} ${total === 1 ? "notification" : "notifications"}. `}Everything Meridian has told you, newest first. Open one to mark it read`}
          actions={<Button variant="secondary" pending={markAllRead.isPending} disabled={(unread.data ?? 0) === 0} onClick={() => markAllRead.mutate()}>Mark all read</Button>}
        />
      }
      filterBar={
        <div className="flex flex-wrap items-center gap-3">
          <Select label="Type" value={type} onValueChange={(v) => { setLimit(PAGE); setType(v === "all" ? "" : v); }} options={TYPE_OPTIONS} />
          <Switch label="Unread only" checked={unreadOnly} onCheckedChange={(on) => { setLimit(PAGE); setUnread(on ? "1" : ""); }} />
        </div>
      }
      state={asyncStateOf(q, () => items.length === 0, true)}
      emptyProps={{
        title: filtering ? "No notifications match" : "You are all caught up",
        detail: filtering ? "Try another type or show read notifications" : "Findings, approvals and digests appear here",
        action: filtering ? <Button variant="secondary" onClick={() => { setType(""); setUnread(""); }}>Clear filters</Button> : undefined,
        ghost: "table",
      }}
      errorProps={{ error: q.error, onRetry: () => void q.refetch() }}
      table={
        <Card padding="sm">
          <ul>{groups.map((g) => <NotificationRow key={g.n.id} n={g.n} count={g.count} showBody onOpen={onOpen} onMarkRead={readAll} />)}</ul>
          {items.length < total && (
            <div className="px-3 pt-2">
              <Button variant="secondary" onClick={() => setLimit((l) => l + PAGE)}>Show more</Button>
            </div>
          )}
        </Card>
      }
    />
  );
}

"use client";

import "../approvals.css";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/format";
import { useV2Href } from "@/lib/v2/hooks";
import { groupNotifications, kindOf, linkOf, sentenceOf } from "@/lib/v2/inbox";
import { useMarkRead, useNotifications, useUnread } from "@/lib/v2/approvals-queries";
import { useLandscape } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import type { Notification } from "@/types/api";
import { InspectorFrame } from "../Inspector";
import { SeverityMark } from "../marks";
import { EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../parts";
import { MentionCount } from "./collab";
import { t as tr } from "@/lib/v2/i18n";
import { v2Locale } from "@/lib/v2/format";

/** A time in the viewer's day: "08:41" for today, "3 Oct" before. */
function when(iso: string, today: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return today ? d.toLocaleTimeString(v2Locale(), { hour: "2-digit", minute: "2-digit" }) : formatDate(iso, "date");
}

interface ItemProps {
  n: Notification;
  today: boolean;
  active: boolean;
  focusable: boolean;
  objectLabel: (module: string) => string | null;
  onRead: (id: string) => void;
}

function Item({ n, today, active, focusable, objectLabel, onRead }: ItemProps) {
  const kind = kindOf(n.type);
  const link = linkOf(n.link, objectLabel);
  const sentence = sentenceOf(n);
  return (
    <li className="m2-nitem" id={`n-${n.id}`} data-nid={n.id} data-active={active ? "true" : undefined} data-unread={n.is_read ? undefined : "true"} tabIndex={focusable ? 0 : -1} aria-label={`${n.is_read ? "" : "Unread. "}${kind.word}. ${sentence}`}>
      <span className="m2-nk">
        {n.is_read ? null : <span className="m2-unread" aria-hidden="true" />}
        <SeverityMark severity={kind.severity} />
        {kind.word}
      </span>
      <span className="m2-nat">{when(n.created_at, today)}</span>
      <span className="m2-ns">{sentence}</span>
      <span className="m2-na">
        {link ? (
          link.external ? (
            <a href={link.href} onClick={() => !n.is_read && onRead(n.id)}>
              {link.label}
            </a>
          ) : (
            <V2Link href={link.href} onClick={() => !n.is_read && onRead(n.id)}>
              {link.label}
            </V2Link>
          )
        ) : null}
        {n.is_read ? null : (
          <button type="button" className="m2-linkbtn2" aria-label={tr("Mark read: {sentence}", { sentence })} onClick={() => onRead(n.id)}>
            {tr("Mark read")}
          </button>
        )}
      </span>
    </li>
  );
}

function Group({ title, items, today, ...rest }: { title: string; items: Notification[]; today: boolean } & Omit<ItemProps, "n" | "today" | "active" | "focusable"> & { activeId: string | null }) {
  if (items.length === 0) return null;
  const { activeId, ...item } = rest;
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      <ul className="m2-nlist">
        {items.map((n) => (
          <Item key={n.id} n={n} today={today} active={activeId === n.id} focusable={activeId === n.id} {...item} />
        ))}
      </ul>
    </section>
  );
}

/**
 * `?open=inbox`: the notifications, grouped Today and Earlier, in the inspector's frame. j and k move, Enter opens the
 * highlighted one (and marks it read); marking read refetches the list and the count in the top bar.
 */
export function InboxPanel({ onClose }: { onClose: () => void }) {
  const q = useNotifications();
  const unread = useUnread().data?.count;
  const { one, all } = useMarkRead();
  const landscape = useLandscape(null).data;
  const router = useRouter();
  const v2Href = useV2Href();
  const root = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupNotifications(q.data?.items ?? []), [q.data]);
  const order = useMemo(() => [...groups.today, ...groups.earlier], [groups]);
  const [activeId, setActive] = useState<string | null>(null);
  const current = activeId && order.some((n) => n.id === activeId) ? activeId : (order[0]?.id ?? null);
  const objectLabel = useCallback((module: string) => landscape?.objects.find((o) => o.module === module)?.label ?? null, [landscape]);
  const read = useCallback((id: string) => one.mutate(id), [one]);

  // Focus the first notification when the list arrives, after the frame has put focus on Close.
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || order.length === 0) return;
    focused.current = true;
    const t = setTimeout(() => root.current?.querySelector<HTMLElement>("li[tabindex='0']")?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(t);
  }, [order.length]);

  const move = (dir: 1 | -1) => {
    const at = order.findIndex((n) => n.id === current);
    const next = order[Math.min(order.length - 1, Math.max(0, at + dir))];
    if (!next) return;
    setActive(next.id);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`#n-${CSS.escape(next.id)}`)?.focus({ preventScroll: false }));
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const row = (e.target as HTMLElement).closest("li[data-nid]");
    if (!row) return;
    const onRow = e.target === row;
    if ((e.key === "j" || e.key === "ArrowDown") && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      move(1);
    } else if ((e.key === "k" || e.key === "ArrowUp") && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter" && onRow) {
      const n = order.find((x) => x.id === row.getAttribute("data-nid"));
      const link = n ? linkOf(n.link, objectLabel) : null;
      if (!n) return;
      e.preventDefault();
      if (!n.is_read) read(n.id);
      if (link) {
        if (link.external) window.location.assign(link.href);
        else router.push(v2Href(link.href));
      }
    }
  };

  const count = unread ?? order.filter((n) => !n.is_read).length;
  return (
    <InspectorFrame title={tr("Inbox")} status={q.data ? tr("{count} unread", { count: int(count) }) : undefined} onClose={onClose}>
      <div ref={root} onKeyDown={onKeyDown} data-testid="inbox-panel">
        <div className="m2-inbox-tools">
          <button type="button" className="m2-btn m2-sm" disabled={count === 0 || all.isPending} onClick={() => all.mutate()}>
            {tr("Mark all read")}
          </button>
          <a href="?open=preferences" className="m2-meta">
            {tr("Notification settings")}
          </a>
          <MentionCount />
        </div>
        {all.isError || one.isError ? <ErrorFrame>{tr("The change could not be saved. Try again.")}</ErrorFrame> : null}
        {q.isLoading ? (
          <Skeleton width="100%" height={160} />
        ) : q.isError ? (
          <ErrorFrame onRetry={() => void q.refetch()}>{tr("The notifications could not be read.")}</ErrorFrame>
        ) : order.length === 0 ? (
          <EmptyFrame>{tr("Nothing has been sent to you. Approvals, SLA warnings and digests arrive here.")}</EmptyFrame>
        ) : (
          <>
            <Group title={tr("Today")} items={groups.today} today activeId={current} objectLabel={objectLabel} onRead={read} />
            <Group title={tr("Earlier")} items={groups.earlier} today={false} activeId={current} objectLabel={objectLabel} onRead={read} />
            <p className="m2-prov m2-nfoot">{tr("j and k move, Enter opens.")}</p>
          </>
        )}
      </div>
    </InspectorFrame>
  );
}

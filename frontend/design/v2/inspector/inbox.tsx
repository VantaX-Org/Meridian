"use client";

import "../approvals.css";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/format";
import { useV2Href } from "@/lib/v2/hooks";
import { groupNotifications, kindOf, linkOf, sentenceOf } from "@/lib/v2/inbox";
import { useMarkRead, useNextSteps, useNotifications, useUnread } from "@/lib/v2/approvals-queries";
import type { NextStep } from "@/lib/api/v2/people";
import { useLandscape } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import type { Notification } from "@/types/api";
import { InspectorFrame } from "../Inspector";
import { SeverityMark } from "../marks";
import { EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../parts";
import { MentionCount } from "./collab";
import { DriftInbox } from "../screens/step9/Drift";
import { t as tr } from "@/lib/v2/i18n";

/** A time in the viewer's day: "08:41" for today, "3 Oct" before. */
function when(iso: string, today: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return formatDate(iso, today ? "time" : "date");
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

/** The sentence and the one action of a next step (GET /people/next). */
function stepWords(s: NextStep): { kind: string; sentence: string; action: string; severity: "critical" | "high" | "medium" | "low" } {
  switch (s.kind) {
    case "task":
      return { kind: tr("Approval"), sentence: tr("{title} waits for your decision.", { title: s.title }), action: tr("Decide"), severity: "medium" };
    case "approve_batch":
      return { kind: tr("Approval"), sentence: tr("Batch {title} waits for your approval.", { title: s.title }), action: tr("Open the batch"), severity: "medium" };
    case "sent_back":
      return { kind: tr("Sent back"), sentence: tr("Batch {title} was sent back to you.", { title: s.title }), action: tr("Open the batch"), severity: "high" };
    case "load":
      return { kind: tr("SAP load"), sentence: tr("Batch {title} waits for you to load it in SAP and confirm.", { title: s.title }), action: tr("Confirm the load"), severity: "medium" };
    case "overdue":
      return { kind: tr("Overdue"), sentence: tr("{n} {count, plural, one {record assigned to you is} other {records assigned to you are}} past the due date.", { n: int(s.count), count: s.count }), action: tr("Open the ledger"), severity: "high" };
    default:
      return { kind: tr("Job failed"), sentence: tr("{n} {count, plural, one {job} other {jobs}} failed on {title}.", { n: int(s.count), count: s.count, title: s.title }), action: tr("Open the job"), severity: "critical" };
  }
}

/**
 * What waits for the caller, in the order to do it, each with its one action: approvals, batches sent back, loads to
 * confirm, overdue work, failed jobs (GET /people/next). Leads the inbox and the start screen. `quiet`: draw nothing
 * when nothing waits (the start screen); the inbox says so.
 */
export function NextList({ quiet = false }: { quiet?: boolean }) {
  const q = useNextSteps();
  const items = q.data?.items ?? [];
  if (q.isLoading || q.isError || (quiet && items.length === 0)) return null;
  return (
    <section aria-label={tr("Next steps")} data-testid="next-steps">
      <h3>{tr("Next steps")}</h3>
      {items.length === 0 ? (
        <p className="m2-prov">{tr("Nothing waits for you.")}</p>
      ) : (
        <ul className="m2-nlist">
          {items.map((s) => {
            const w = stepWords(s);
            return (
              <li key={`${s.kind}:${s.id}`} className="m2-nitem" data-kind={s.kind}>
                <span className="m2-nk">
                  <SeverityMark severity={w.severity} />
                  {w.kind}
                </span>
                <span className="m2-nat">{s.due_at ? tr("Due {date}", { date: when(s.due_at, false) }) : null}</span>
                <span className="m2-ns">{w.sentence}</span>
                <span className="m2-na">
                  <V2Link href={s.href}>{w.action}</V2Link>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * `?open=inbox`: the next steps, then the notifications, grouped Today and Earlier, in the inspector's frame. j and k move, Enter opens the
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
        <NextList />
        <DriftInbox />
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

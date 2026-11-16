"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/format";
import { useV2Href } from "@/lib/v2/hooks";
import { groupNotifications, kindOf, linkOf, sentenceOf } from "@/lib/v2/inbox";
import { useMarkRead, useNextSteps, useNotifications, useUnread } from "@/lib/v2/approvals-queries";
import type { NextStep } from "@/lib/api/v2/people";
import { useLandscape } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import { driftWords } from "@/lib/v2/step9";
import { useDriftAlerts } from "@/lib/v2/step9-queries";
import type { Notification } from "@/types/api";
import { t } from "@/lib/v2/i18n";
import { SeverityMark } from "@/design/v2/marks";
import { V2Link } from "@/design/v2/parts";
import { Button, EmptyState, ErrorState, Skeleton } from "../../kit";
import { InspectorFrame, type BodyProps } from "./frame";
import { MentionCount } from "./panels-kit";

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
  objectLabel: (module: string) => string | null;
  onRead: (id: string) => void;
}

function Item({ n, today, active, objectLabel, onRead }: ItemProps) {
  const kind = kindOf(n.type);
  const link = linkOf(n.link, objectLabel);
  const sentence = sentenceOf(n);
  return (
    <li className="nx-ib-row nx-pn-item" id={`n-${n.id}`} data-nid={n.id} data-active={active ? "true" : undefined} data-unread={n.is_read ? undefined : "true"} tabIndex={active ? 0 : -1} aria-label={`${n.is_read ? "" : "Unread. "}${kind.word}. ${sentence}`}>
      <span className="nx-pn-row">
        <SeverityMark severity={kind.severity} />
        <b>{kind.word}</b>
        <span className="nx-pn-meta">{when(n.created_at, today)}</span>
      </span>
      <span>{sentence}</span>
      <span className="nx-pn-row">
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
          <button type="button" className="nx-pn-linkbtn" aria-label={t("Mark read: {sentence}", { sentence })} onClick={() => onRead(n.id)}>
            {t("Mark read")}
          </button>
        )}
      </span>
    </li>
  );
}

function Group({ title, items, today, activeId, objectLabel, onRead }: { title: string; items: Notification[]; today: boolean; activeId: string | null; objectLabel: ItemProps["objectLabel"]; onRead: ItemProps["onRead"] }) {
  if (items.length === 0) return null;
  return (
    <section className="nx-ib-sec" aria-label={title}>
      <h3>{title}</h3>
      <ul className="nx-ib-list">
        {items.map((n) => (
          <Item key={n.id} n={n} today={today} active={activeId === n.id} objectLabel={objectLabel} onRead={onRead} />
        ))}
      </ul>
    </section>
  );
}

/** The sentence and the one action of a next step (GET /people/next). */
function stepWords(s: NextStep): { kind: string; sentence: string; action: string; severity: "critical" | "high" | "medium" | "low" } {
  switch (s.kind) {
    case "task":
      return { kind: t("Approval"), sentence: t("{title} waits for your decision.", { title: s.title }), action: t("Decide"), severity: "medium" };
    case "approve_batch":
      return { kind: t("Approval"), sentence: t("Batch {title} waits for your approval.", { title: s.title }), action: t("Open the batch"), severity: "medium" };
    case "sent_back":
      return { kind: t("Sent back"), sentence: t("Batch {title} was sent back to you.", { title: s.title }), action: t("Open the batch"), severity: "high" };
    case "load":
      return { kind: t("SAP load"), sentence: t("Batch {title} waits for you to load it in SAP and confirm.", { title: s.title }), action: t("Confirm the load"), severity: "medium" };
    case "overdue":
      return { kind: t("Overdue"), sentence: t("{n} {count, plural, one {record assigned to you is} other {records assigned to you are}} past the due date.", { n: int(s.count), count: s.count }), action: t("Open the ledger"), severity: "high" };
    default:
      return { kind: t("Job failed"), sentence: t("{n} {count, plural, one {job} other {jobs}} failed on {title}.", { n: int(s.count), count: s.count, title: s.title }), action: t("Open the job"), severity: "critical" };
  }
}

/** What waits for the caller, in the order to do it, each with its one action (GET /people/next). */
function NextList() {
  const q = useNextSteps();
  const items = q.data?.items ?? [];
  if (q.isLoading || q.isError) return null;
  return (
    <section className="nx-ib-sec" aria-label={t("Next steps")} data-testid="next-steps">
      <h3>{t("Next steps")}</h3>
      {items.length === 0 ? (
        <p className="nx-pn-meta">{t("Nothing waits for you.")}</p>
      ) : (
        <ul className="nx-ib-list">
          {items.map((s) => {
            const w = stepWords(s);
            return (
              <li key={`${s.kind}:${s.id}`} className="nx-ib-row" data-kind={s.kind}>
                <span className="nx-pn-row">
                  <SeverityMark severity={w.severity} />
                  <b>{w.kind}</b>
                  {s.due_at ? <span className="nx-pn-meta">{t("Due {date}", { date: when(s.due_at, false) })}</span> : null}
                </span>
                <span>{w.sentence}</span>
                <V2Link href={s.href}>{w.action}</V2Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The latest configuration drift alerts (same as the v2 DriftInbox): nothing drawn when there are none. */
function DriftList() {
  const q = useDriftAlerts(5);
  if (q.isPending || q.isError || !q.data.alerts.length) return null;
  return (
    <section className="nx-ib-sec" aria-label={t("Configuration changes")} data-testid="inbox-drift">
      <h3>{t("Configuration changes")}</h3>
      <ul className="nx-ib-list">
        {q.data.alerts.map((a) => (
          <li key={a.id} className="nx-ib-row">
            <span className="nx-pn-row">
              <b>{a.system_name ?? t("A system")}</b>
              <span className="nx-pn-meta">{formatDate(a.created_at, "datetime")}</span>
            </span>
            <span>
              {t("{changes}. {rules} {rules, plural, one {rule depends} other {rules depend}} on it; {owners} {owners, plural, one {owner} other {owners}} told; {rescore}.", {
                changes: driftWords(a),
                rules: a.rules.length,
                owners: a.notified,
                rescore: a.rescore_queued ? t("re-score queued") : t("not re-scored"),
              })}
            </span>
            {a.system_id ? <V2Link href={`/s/${encodeURIComponent(a.system_id)}?tab=changes`}>{t("Open the changes")}</V2Link> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** `?open=inbox`: next steps, drift alerts, then notifications grouped Today and Earlier. j and k move, Enter opens and marks read. */
export function InboxBody({ onClose }: BodyProps) {
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
    const id = setTimeout(() => root.current?.querySelector<HTMLElement>("li[tabindex='0']")?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(id);
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
      if (!n) return;
      const link = linkOf(n.link, objectLabel);
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
    <InspectorFrame title={t("Inbox")} status={q.data ? t("{count} unread", { count: int(count) }) : undefined} onClose={onClose}>
      <div ref={root} onKeyDown={onKeyDown} data-testid="inbox-panel">
        <div className="nx-pn-row">
          <Button variant="secondary" size={32} disabled={count === 0 || all.isPending} onClick={() => all.mutate()}>
            {t("Mark all read")}
          </Button>
          <a href="?open=preferences" className="nx-pn-meta">
            {t("Notification settings")}
          </a>
          <MentionCount />
        </div>
        <NextList />
        <DriftList />
        {all.isError || one.isError ? (
          <p className="nx-pn-err" role="alert">
            {t("The change could not be saved. Try again.")}
          </p>
        ) : null}
        {q.isLoading ? (
          <Skeleton lines={5} label={t("Inbox")} />
        ) : q.isError ? (
          <ErrorState sentence={t("The notifications could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
        ) : order.length === 0 ? (
          <EmptyState heading={t("Nothing has been sent to you. Approvals, SLA warnings and digests arrive here.")} />
        ) : (
          <>
            <Group title={t("Today")} items={groups.today} today activeId={current} objectLabel={objectLabel} onRead={read} />
            <Group title={t("Earlier")} items={groups.earlier} today={false} activeId={current} objectLabel={objectLabel} onRead={read} />
            <p className="nx-pn-meta">{t("j and k move, Enter opens.")}</p>
          </>
        )}
      </div>
    </InspectorFrame>
  );
}

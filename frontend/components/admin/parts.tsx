"use client";

/**
 * Admin building blocks shared by more than one tab: the health doctor card,
 * the read-only audit table and the typed-confirmation block for removals.
 */

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { Button, Field, Input, SectionCard, StatusBadge } from "@/components/ui-core";
import type { DoctorItem } from "@/lib/api/admin-doctor";
import { formatDate, humanizeIds } from "@/lib/format";

/** Where to fix an amber row. Rows with no settings tab get no link. */
const FIX_HREF: Record<string, string> = { llm: "/admin?tab=ai", licence: "/admin?tab=licence" };

const doctorLabel = (s: string) => s.replace(/\s*\(\s*\)/g, "").trim();
const doctorDetail = (s: string) => humanizeIds(s
  .replace(/no api key\s*[-\u2014]\s*AI features degrade/i, "No API key stored. AI features are reduced.")
  .replace(/api key present/i, "API key stored")
  .replace(/^expires (\S+)$/, (_m, d: string) => `Expires ${formatDate(d)}`)
  .replace(/^licence cache empty$/i, "Not validated yet"));

const DOCTOR_STATUS = { ok: "ok", warn: "medium", fail: "failed" } as const;

export function DoctorCard({ items, lastChecked, onRefresh }: { items: ReadonlyArray<DoctorItem>; lastChecked: string; onRefresh?: () => void }) {
  const warn = items.filter((i) => i.status === "warn").length;
  const fail = items.filter((i) => i.status === "fail").length;
  const ok = items.length - warn - fail;
  return (
    <SectionCard title="Health checks" meta={`Last checked ${lastChecked}`}
      action={onRefresh ? <Button size="sm" variant="ghost" onClick={onRefresh}>Check again</Button> : undefined}>
      <p className="ui-note" role="status">{ok} passing{warn ? `, ${warn} warning` : ""}{fail ? `, ${fail} failing` : ""}</p>
      <ul className="ui-doctor">
        {items.map((i) => (
          <li key={i.id} className="ui-doctor__item">
            <StatusBadge status={DOCTOR_STATUS[i.status]}>{doctorLabel(i.label)}</StatusBadge>
            {i.detail ? <span className="ui-micro">{doctorDetail(i.detail)}</span> : null}
            {i.status !== "ok" && FIX_HREF[i.id] ? <Link href={FIX_HREF[i.id]} className="ui-link">Fix</Link> : null}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

export interface AuditRow { id: string; timestamp: string; displayTime: ReactNode; actor: ReactNode; action: ReactNode; context?: ReactNode }

export function AuditLogTable({ entries, emptyLabel = "No audit activity recorded yet." }: { entries: ReadonlyArray<AuditRow>; emptyLabel?: string }) {
  if (!entries.length) return <p className="ui-note">{emptyLabel}</p>;
  return (
    <SectionCard title="Audit log" meta={`${entries.length} most recent`} flush>
      <div className="ui-scroll-x">
        <table className="ui-mini-table" aria-label="Audit log">
          <thead><tr><th scope="col">When</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Context</th></tr></thead>
          <tbody>{entries.map((e) => (
            <tr key={e.id}>
              <td><time dateTime={e.timestamp}>{e.displayTime}</time></td>
              <td>{e.actor}</td><td>{e.action}</td><td className="ui-micro">{e.context ?? "None"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </SectionCard>
  );
}

/** Inline confirmation. The confirm button stays off until the expected text is typed exactly. */
export function DestructiveConfirm({ title, body, expected, confirmLabel, cancelLabel = "Cancel", onConfirm, onCancel, busy }: {
  title: string; body: ReactNode; expected: string; confirmLabel: string; cancelLabel?: string; onConfirm: () => void; onCancel: () => void; busy?: boolean;
}) {
  const [typed, setTyped] = useState("");
  const id = useId();
  return (
    <div className="ui-form" role="alertdialog" aria-labelledby={`${id}-t`}>
      <h2 id={`${id}-t`} className="ui-drawer-head__title">{title}</h2>
      <p className="ui-note">{body}</p>
      <Field label="Confirm by typing">{({ controlId }) => <Input id={controlId} value={typed} autoComplete="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} />}</Field>
      <div className="ui-form__actions">
        <Button variant="danger" disabled={typed !== expected || busy} onClick={onConfirm}>{confirmLabel}</Button>
        <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
      </div>
    </div>
  );
}

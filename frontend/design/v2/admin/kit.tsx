"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { writeClipboard } from "@/lib/browser";
import { relativeTime } from "@/lib/format";
import { apiErrorMessage } from "@/lib/error";
import { useV2Session } from "@/lib/v2/hooks";
import { VerdictMark } from "../marks";
import { ErrorFrame, PageTitle, Skeleton } from "../parts";
import { useToast } from "../Toast";
import "../admin.css";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** The viewer's `can(action)`: true for everything in fixture mode. */
export const useCan = (): ((action: string) => boolean) => useV2Session().can;

/** A canvas of the Admin area: the h1, one sentence under it and the actions that belong to the whole canvas. */
export function AdminPage({ title, lead, actions, children }: { title: ReactNode; lead?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <PageTitle>{title}</PageTitle>
      {lead ? <p className="m2-adm-lead">{lead}</p> : null}
      {actions ? <div className="m2-adm-acts">{actions}</div> : null}
      {children}
    </>
  );
}

/** A titled block of a canvas. */
export function Block({ title, hint, children, id }: { title?: ReactNode; hint?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="m2-adm-blk" aria-label={typeof title === "string" ? title : undefined} id={id}>
      {title ? <h2>{title}</h2> : null}
      {hint ? <p className="m2-adm-hint">{hint}</p> : null}
      {children}
    </section>
  );
}

/** A labelled control. The label wraps the control, so a click on it focuses the field and a reader names it. */
export function Fld({ label, hint, error, children, wide, mono }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; wide?: boolean; mono?: boolean }) {
  return (
    <label className={`m2-fld${wide ? " m2-wide" : ""}${mono ? " m2-mono-in" : ""}`}>
      <span className="m2-lbl">{label}</span>
      {children}
      {error ? (
        <span className="m2-err" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="m2-hint">{hint}</span>
      ) : null}
    </label>
  );
}

export function Sw({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className="m2-sw">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

export function Kv({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="m2-kv">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Note({ tone, children }: { tone?: "warn" | "bad"; children: ReactNode }) {
  return (
    <div className="m2-note" data-tone={tone} role={tone === "bad" ? "alert" : undefined}>
      {children}
    </div>
  );
}

/** What stands where a section needs a permission the viewer lacks: it says which, and does not offer the controls. */
export function NeedsPermission({ what, permission }: { what: string; permission: string }) {
  return (
    <div className="m2-empty" data-testid="needs-permission">
      <p>{`${what} needs the ${permission.replace(/_/g, " ")} permission. Ask an administrator to grant it.`}</p>
    </div>
  );
}

/** Verdict mark and a word: status is never colour alone. */
export function StatusWord({ tone, children }: { tone: "go" | "at-risk" | "no-go" | "neutral"; children: ReactNode }) {
  return (
    <span className="m2-v">
      {tone === "neutral" ? null : <VerdictMark verdict={tone} />}
      {children}
    </span>
  );
}

/** The loading and failed states of a read; renders `children(data)` once it has data. */
export function Loaded<T>({ q, what, rows = 4, children }: { q: UseQueryResult<T>; what: string; rows?: number; children: (data: T) => ReactNode }) {
  if (q.isError) {
    return (
      <ErrorFrame onRetry={() => void q.refetch()}>
        {`${what} could not be read. ${apiErrorMessage(q.error)}`}
      </ErrorFrame>
    );
  }
  if (!q.data) {
    return (
      <div aria-busy="true" data-testid="loading">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <Skeleton width="100%" height={20} />
          </div>
        ))}
      </div>
    );
  }
  return <>{children(q.data)}</>;
}

/** A dialog in the v2 style: scrim, focus trapped, Esc closes, focus returns to what opened it. */
export function Dialog({ title, description, children, onClose, wide }: { title: string; description?: ReactNode; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = root.current?.querySelector<HTMLElement>("input,select,textarea,button");
    first?.focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab" && root.current) {
      const els = Array.from(root.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  return (
    <div onKeyDown={onKeyDown}>
      <div className="m2-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={root} className="m2-pal m2-dlg" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} style={wide ? { width: "min(640px, calc(100vw - 32px))" } : undefined} data-testid="admin-dialog">
        <h2 id={`${id}-t`}>{title}</h2>
        {description ? <p className="m2-dlg-d">{description}</p> : null}
        {children}
      </div>
    </div>
  );
}

/** A confirmation: what will happen, and the one button that does it. `phrase` makes the person type it first. */
export function Confirm({ title, body, confirm, cancel = "Cancel", danger, phrase, pending, onConfirm, onCancel }: { title: string; body: ReactNode; confirm: string; cancel?: string; danger?: boolean; phrase?: string; pending?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const [typed, setTyped] = useState("");
  const ok = !phrase || typed.trim() === phrase;
  return (
    <Dialog title={title} description={body} onClose={onCancel}>
      {phrase ? (
        <label>
          {`Type "${phrase}" to continue`}
          <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </label>
      ) : null}
      <div className="m2-dlg-a">
        <button type="button" className="m2-btn" onClick={onCancel}>
          {cancel}
        </button>
        <button type="button" className={`m2-btn m2-strong${danger ? " m2-crit" : ""}`} disabled={!ok || pending} onClick={onConfirm}>
          {pending ? "Working…" : confirm}
        </button>
      </div>
    </Dialog>
  );
}

/** "Done" with Undo for the changes the API can reverse: a notice that takes the change back by its own call. */
export function useDone(): (label: string, undo?: () => Promise<unknown>) => void {
  const toast = useToast();
  return (label, undo) => (undo ? toast.done({ ids: [], label, undo: async () => void (await undo()) }) : toast.show(label));
}

/** Copies text; resolves to whether the browser allowed it. */
export const copyText = (text: string): Promise<boolean> => writeClipboard(text);

export const since = (iso: string | null | undefined, never = "Never"): string => (iso ? relativeTime(iso) : never);

/** The rows shown as "from 1 to 50 of 211" with Previous and Next. */
export function Pager({ offset, limit, total, onPage }: { offset: number; limit: number; total: number; onPage: (offset: number) => void }) {
  if (total <= limit) return <div className="m2-pagebar">{`${total} ${total === 1 ? "entry" : "entries"}`}</div>;
  return (
    <div className="m2-pagebar">
      <span>{`${offset + 1} to ${Math.min(total, offset + limit)} of ${total}`}</span>
      <span style={{ display: "inline-flex", gap: 8 }}>
        <button type="button" className="m2-btn m2-sm" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - limit))}>
          Previous
        </button>
        <button type="button" className="m2-btn m2-sm" disabled={offset + limit >= total} onClick={() => onPage(offset + limit)}>
          Next
        </button>
      </span>
    </div>
  );
}

"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { writeClipboard } from "@/lib/browser";
import { relTime } from "@/lib/v2/format";
import { formatDate } from "@/lib/format";
import { apiErrorMessage } from "@/lib/error";
import { useV2Session } from "@/lib/v2/hooks";
import { VerdictMark } from "../marks";
import { ErrorFrame, PageTitle, Skeleton } from "../parts";
import { useToast } from "../Toast";
import "../admin.css";
import "../basis.css";
import { t } from "@/lib/v2/i18n";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** The viewer's `can(action)`: true for everything in fixture mode. */
export const useCan = (): ((action: string) => boolean) => useV2Session().can;

/* Unsaved changes: every form that differs from what it loaded registers here, so its block heading, the admin index
   and a leave warning can say so. */
const unsaved = new Set<string>();
const listeners = new Set<() => void>();
function markUnsaved(id: string, on: boolean): void {
  if (on === unsaved.has(id)) return;
  if (on) unsaved.add(id);
  else unsaved.delete(id);
  listeners.forEach((f) => f());
}
const subscribe = (f: () => void) => (listeners.add(f), () => void listeners.delete(f));
/** How many forms on the page hold changes nobody saved. */
export const useUnsavedCount = (): number => useSyncExternalStore(subscribe, () => unsaved.size, () => 0);
const BlockDirty = createContext<((on: boolean) => void) | null>(null);

/** Registers `on` as unsaved changes for as long as the caller is mounted. */
function useMark(on: boolean): void {
  const id = useId();
  useEffect(() => {
    markUnsaved(id, on);
    return () => markUnsaved(id, false);
  }, [id, on]);
}

/**
 * True once `value` differs from what it was on the first render; the enclosing Block shows **Unsaved** while it does.
 * A form remounts (by key) on what it saved, so a save clears it.
 */
export function useUnsaved(value: unknown): boolean {
  const [first] = useState(() => JSON.stringify(value));
  const on = JSON.stringify(value) !== first;
  const setBlock = useContext(BlockDirty);
  useMark(on);
  useEffect(() => {
    setBlock?.(on);
    return () => setBlock?.(false);
  }, [setBlock, on]);
  return on;
}

/** Asks before leaving the page, by link or by closing the tab, while any form holds unsaved changes. */
function useLeaveWarning(): void {
  const n = useUnsavedCount();
  useEffect(() => {
    if (n === 0) return;
    const message = t("You have unsaved changes. Leave without saving them?");
    const unload = (e: BeforeUnloadEvent) => e.preventDefault();
    const click = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!a || a.getAttribute("href")?.startsWith("#") || new URL(a.getAttribute("href") ?? "", location.href).pathname === location.pathname) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [n]);
}

/** A canvas of the Admin area: the h1, one sentence under it and the actions that belong to the whole canvas. */
export function AdminPage({ title, lead, actions, children }: { title: ReactNode; lead?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  useLeaveWarning();
  return (
    <>
      <PageTitle>{title}</PageTitle>
      {lead ? <p className="m2-adm-lead">{lead}</p> : null}
      {actions ? <div className="m2-adm-acts">{actions}</div> : null}
      {children}
    </>
  );
}

/** A titled block of a canvas. `dirty` (or a form inside calling `useUnsaved`) marks its heading **Unsaved**. */
export function Block({ title, hint, children, id, dirty }: { title?: ReactNode; hint?: ReactNode; children: ReactNode; id?: string; dirty?: boolean }) {
  const [inner, setInner] = useState(false);
  useMark(!!dirty);
  const shown = dirty || inner;
  return (
    <section className="m2-adm-blk" aria-label={typeof title === "string" ? title : undefined} id={id}>
      {title ? (
        <h2>
          {title}
          {shown ? <span className="m2-dirty" data-testid="unsaved">{t("Unsaved")}</span> : null}
        </h2>
      ) : null}
      {hint ? <p className="m2-adm-hint">{hint}</p> : null}
      <BlockDirty.Provider value={setInner}>{children}</BlockDirty.Provider>
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
    <div className="m2-anote" data-tone={tone} role={tone === "bad" ? "alert" : undefined}>
      {children}
    </div>
  );
}

/** What stands where a section needs a permission the viewer lacks: it says which, and does not offer the controls. */
export function NeedsPermission({ what, permission }: { what: string; permission: string }) {
  return (
    <div className="m2-empty" data-testid="needs-permission">
      <p>{t("{what} needs the {replace} permission. Ask an administrator to grant it.", { what, replace: permission.replace(/_/g, " ") })}</p>
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
        {t("{what} could not be read. {apiErrorMessage}", { what, apiErrorMessage: apiErrorMessage(q.error) })}
      </ErrorFrame>
    );
  }
  if (!q.data) {
    return (
      <div aria-busy="true" data-testid="loading">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ marginBottom: "var(--m2-s2)" }}>
            <Skeleton width="100%" height={20} />
          </div>
        ))}
      </div>
    );
  }
  return <>{children(q.data)}</>;
}

/** A dialog in the v2 style: scrim, focus trapped, Esc closes, focus returns to what opened it. */
export function Dialog({ title, description, children, onClose, wide, className }: { title: string; description?: ReactNode; children: ReactNode; onClose: () => void; wide?: boolean; className?: string }) {
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
      <div ref={root} className={`m2-pal m2-dlg${className ? ` ${className}` : ""}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} style={wide ? { width: "min(640px, calc(100vw - 32px))" } : undefined} data-testid="admin-dialog">
        <h2 id={`${id}-t`}>{title}</h2>
        {description ? <p className="m2-dlg-d">{description}</p> : null}
        {children}
      </div>
    </div>
  );
}

/** A confirmation: what will happen, and the one button that does it. `phrase` makes the person type it first. */
export function Confirm({ title, body, confirm, cancel = t("Cancel"), danger, phrase, pending, onConfirm, onCancel }: { title: string; body: ReactNode; confirm: string; cancel?: string; danger?: boolean; phrase?: string; pending?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const [typed, setTyped] = useState("");
  const ok = !phrase || typed.trim() === phrase;
  return (
    <Dialog title={title} description={body} onClose={onCancel}>
      {phrase ? (
        <label>
          {t("Type \"{phrase}\" to continue", { phrase })}
          <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </label>
      ) : null}
      <div className="m2-dlg-a">
        <button type="button" className="m2-btn" onClick={onCancel}>
          {cancel}
        </button>
        <button type="button" className={`m2-btn m2-strong${danger ? " m2-crit" : ""}`} disabled={!ok || pending} onClick={onConfirm}>
          {pending ? t("Working…") : confirm}
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

export const since = (iso: string | null | undefined, never = t("Never")): string => (iso ? relTime(iso) : never);

/** "11 days ago", with the date and time on hover and for assistive technology: relative where it helps, exact on demand. */
export function Since({ at, never }: { at: string | null | undefined; never?: string }) {
  if (!at) return <>{never ?? t("Never")}</>;
  const exact = formatDate(at, "datetime");
  return (
    <time dateTime={at} title={exact}>
      {relTime(at)}
    </time>
  );
}

/** The rows shown as "from 1 to 50 of 211" with Previous and Next. */
export function Pager({ offset, limit, total, onPage }: { offset: number; limit: number; total: number; onPage: (offset: number) => void }) {
  if (total <= limit) return <div className="m2-pagebar">{t("{total} {total, plural, one {entry} other {entries}}", { total })}</div>;
  return (
    <div className="m2-pagebar">
      <span>{t("{count} to {min} of {total}", { count: offset + 1, min: Math.min(total, offset + limit), total })}</span>
      <span style={{ display: "inline-flex", gap: "var(--m2-s2)" }}>
        <button type="button" className="m2-btn m2-sm" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - limit))}>
          {t("Previous")}
        </button>
        <button type="button" className="m2-btn m2-sm" disabled={offset + limit >= total} onClick={() => onPage(offset + limit)}>
          {t("Next")}
        </button>
      </span>
    </div>
  );
}

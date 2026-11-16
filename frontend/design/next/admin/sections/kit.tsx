"use client";

import { createContext, useContext, useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { writeClipboard } from "@/lib/browser";
import { relTime } from "@/lib/v2/format";
import { formatDate } from "@/lib/format";
import { apiErrorMessage } from "@/lib/error";
import { useV2Session } from "@/lib/v2/hooks";
import { usePermissions } from "@/lib/permissions";
import { requestTargetFor } from "@/lib/rbac";
import { Button, Chip, Confirm as KitConfirm, EmptyState, ErrorState, Sheet, Skeleton } from "@/design/next/kit";
import { PageTitle } from "./parts";
import { useToast } from "./Toast";
import { t } from "@/lib/v2/i18n";


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

/** A canvas of the Admin area: the kit page title, one sentence under it and the actions that belong to the whole canvas. */
export function AdminPage({ title, lead, actions, children }: { title: string; lead?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  useLeaveWarning();
  return (
    <>
      <PageTitle sub={lead}>{title}</PageTitle>
      {actions ? <div className="nx-adm-acts">{actions}</div> : null}
      {children}
    </>
  );
}

/** A titled content sheet of a canvas. `dirty` (or a form inside calling `useUnsaved`) marks its heading **Unsaved**. */
export function Block({ title, hint, children, id, dirty }: { title?: ReactNode; hint?: ReactNode; children: ReactNode; id?: string; dirty?: boolean }) {
  const [inner, setInner] = useState(false);
  useMark(!!dirty);
  const shown = dirty || inner;
  return (
    <section className="nx-card nx-adm-blk" aria-label={typeof title === "string" ? title : undefined} id={id}>
      {title ? (
        <div className="nx-adm-blk-h">
          <h2 className="nx-kit-h2">{title}</h2>
          {shown ? <span data-testid="unsaved"><Chip tone="warn">{t("Unsaved")}</Chip></span> : null}
        </div>
      ) : null}
      {hint ? <p className="nx-reason">{hint}</p> : null}
      <BlockDirty.Provider value={setInner}>{children}</BlockDirty.Provider>
    </section>
  );
}

/** A labelled control. The label wraps the control, so a click on it focuses the field and a reader names it. */
export function Fld({ label, hint, error, children, wide }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; wide?: boolean; mono?: boolean }) {
  return (
    <label className={`nx-field${wide ? " nx-adm-wide" : ""}`}>
      <span>{label}</span>
      {children}
      {error ? (
        <span role="alert"><Chip tone="bad">{error}</Chip></span>
      ) : hint ? (
        <span className="nx-reason">{hint}</span>
      ) : null}
    </label>
  );
}

export function Sw({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className="nx-adm-sw">
      <input type="checkbox" className="nx-check" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="nx-adm-sw-t">
        <span>{label}</span>
        {hint ? <span className="nx-reason">{hint}</span> : null}
      </span>
    </label>
  );
}

export function Kv({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="nx-adm-kv">
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
    <div className="nx-adm-note" role={tone === "bad" ? "alert" : undefined}>
      {tone ? <Chip tone={tone}>{tone === "bad" ? t("Problem") : t("Warning")}</Chip> : null}
      <span className="nx-reason">{children}</span>
    </div>
  );
}

/** What stands where a section needs a permission the viewer lacks: it says which, and does not offer the controls. */
export function NeedsPermission({ what, permission }: { what: string; permission: string }) {
  return (
    <div data-testid="needs-permission">
      <EmptyState icon="alert" heading={t("{what} needs the {replace} permission. Ask an administrator to grant it.", { what, replace: permission.replace(/_/g, " ") })} action={<RequestAccess permission={permission} />} />
    </div>
  );
}

/** Opens the shell's request-access dialog for a permission the viewer lacks (POST /me/access-requests). */
export function RequestAccess({ permission }: { permission: string }) {
  const { requestAccess } = usePermissions();
  return (
    <Button variant="secondary" size={32} data-testid="request-access" onClick={() => requestAccess(requestTargetFor({ resource: null, action: permission }))}>
      {t("Request access")}
    </Button>
  );
}

const STATUS_TONE = { go: "good", "at-risk": "warn", "no-go": "bad", neutral: "neutral" } as const;

/** A status chip: shape and word, never colour alone. */
export function StatusWord({ tone, children }: { tone: "go" | "at-risk" | "no-go" | "neutral"; children: ReactNode }) {
  return <Chip tone={STATUS_TONE[tone]}>{children}</Chip>;
}

/** The loading and failed states of a read; renders `children(data)` once it has data. */
export function Loaded<T>({ q, what, rows = 4, children }: { q: UseQueryResult<T>; what: string; rows?: number; children: (data: T) => ReactNode }) {
  if (q.isError) return <ErrorState sentence={t("{what} could not be read. {apiErrorMessage}", { what, apiErrorMessage: apiErrorMessage(q.error) })} onRetry={() => void q.refetch()} />;
  if (!q.data) return <div data-testid="loading"><Skeleton lines={rows} label={what} /></div>;
  return <>{children(q.data)}</>;
}

/** A dialog: the kit sheet, with the sentence under its title and the form's own actions inside. */
export function Dialog({ title, description, children, onClose, wide }: { title: string; description?: ReactNode; children: ReactNode; onClose: () => void; wide?: boolean; className?: string }) {
  return (
    <Sheet open onClose={onClose} title={title} size={wide ? "large" : "medium"}>
      <div className="nx-adm-dlg" data-testid="admin-dialog">
        {description ? <p className="nx-reason">{description}</p> : null}
        {children}
      </div>
    </Sheet>
  );
}

/** A confirmation: the kit Confirm. `pending` holds the button off while the change is on its way. */
export function Confirm({ title, body, confirm, danger, phrase, pending, onConfirm, onCancel }: { title: string; body: ReactNode; confirm: string; cancel?: string; danger?: boolean; phrase?: string; pending?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return <KitConfirm open title={title} consequence={body} confirmLabel={pending ? t("Working…") : confirm} danger={danger} phrase={phrase} blocked={pending ? t("Working…") : undefined} onConfirm={onConfirm} onCancel={onCancel} />;
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
  if (total <= limit) return <p className="nx-reason">{t("{total} {total, plural, one {entry} other {entries}}", { total })}</p>;
  return (
    <div className="nx-adm-pager">
      <span className="nx-reason">{t("{count} to {min} of {total}", { count: offset + 1, min: Math.min(total, offset + limit), total })}</span>
      <span className="nx-adm-acts">
        <Button size={32} disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - limit))}>
          {t("Previous")}
        </Button>
        <Button size={32} disabled={offset + limit >= total} onClick={() => onPage(offset + limit)}>
          {t("Next")}
        </Button>
      </span>
    </div>
  );
}

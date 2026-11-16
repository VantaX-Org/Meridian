"use client";

import { Fragment, createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { apiErrorMessage } from "@/lib/error";
import { failureText } from "@/lib/v2/errors";
import { relTime } from "@/lib/v2/format";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { Chip, ErrorState, Skeleton, useToast } from "../kit";
import { Denied } from "../more/states";
import "./tenant.css";

/** v2 status tones mapped to kit chip tones. */
export const TONE = { go: "good", "at-risk": "warn", "no-go": "bad", neutral: "neutral" } as const;
export type V2Tone = keyof typeof TONE;

export const useCan = (): ((action: string) => boolean) => useV2Session().can;

/* Unsaved-changes registry: any block with edits marks itself; the page warns before leaving. */
const unsaved = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
function markUnsaved(id: string, on: boolean) {
  const had = unsaved.has(id);
  if (on && !had) unsaved.add(id);
  else if (!on && had) unsaved.delete(id);
  else return;
  emit();
}
export const useUnsavedCount = (): number => useSyncExternalStore(subscribe, () => unsaved.size, () => 0);

function useMark(on: boolean) {
  const id = useId();
  useEffect(() => {
    markUnsaved(id, on);
    return () => markUnsaved(id, false);
  }, [id, on]);
}

const BlockDirty = createContext<((on: boolean) => void) | null>(null);

/** True once `value` differs from what it was on first render; marks the page and the enclosing block as unsaved. */
export function useUnsaved(value: unknown): boolean {
  const [first] = useState(() => JSON.stringify(value));
  const on = JSON.stringify(value) !== first;
  useMark(on);
  const setBlock = useContext(BlockDirty);
  useEffect(() => {
    if (!setBlock) return;
    setBlock(on);
    return () => setBlock(false);
  }, [setBlock, on]);
  return on;
}

/** Warns before the tab closes or a link leaves the page while any block has unsaved edits. */
export function useLeaveWarning() {
  const count = useUnsavedCount();
  useEffect(() => {
    if (count === 0) return;
    const before = (e: BeforeUnloadEvent) => e.preventDefault();
    const click = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      if (href.startsWith("#")) return;
      try {
        if (new URL(a.href, window.location.href).pathname === window.location.pathname) return;
      } catch {
        return;
      }
      if (!window.confirm(t("You have unsaved changes. Leave without saving them?"))) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", before);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", before);
      document.removeEventListener("click", click, true);
    };
  }, [count]);
}

/** One admin page: lead line, actions, body. Embedded drops the page padding (used inside a sheet). */
export function Page({ lead, actions, embedded, children }: { lead?: ReactNode; actions?: ReactNode; embedded?: boolean; children: ReactNode }) {
  useLeaveWarning();
  return (
    <div className={embedded ? "nx-tn-embedded" : "nx-body nx-tn"}>
      {lead || actions ? (
        <div className="nx-tn-head">
          {lead ? <p className="nx-sub">{lead}</p> : <span />}
          {actions ? <div className="nx-tn-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** A titled block. Shows "Unsaved" beside the title while it or any field inside has edits. */
export function Block({ title, hint, children, id, dirty, actions }: { title?: ReactNode; hint?: ReactNode; children: ReactNode; id?: string; dirty?: boolean; actions?: ReactNode }) {
  const [inner, setInner] = useState(false);
  useMark(!!dirty);
  const label = typeof title === "string" ? title : undefined;
  return (
    <section className="nx-tn-block" id={id} aria-label={label}>
      {title || hint || actions ? (
        <div className="nx-tn-head">
          <div>
            {title ? (
              <h2 className="nx-tn-h2">
                {title}
                {dirty || inner ? (
                  <span data-testid="unsaved">
                    <Chip tone="warn">{t("Unsaved")}</Chip>
                  </span>
                ) : null}
              </h2>
            ) : null}
            {hint ? <p className="nx-sub">{hint}</p> : null}
          </div>
          {actions ? <div className="nx-tn-actions">{actions}</div> : null}
        </div>
      ) : null}
      <BlockDirty.Provider value={setInner}>{children}</BlockDirty.Provider>
    </section>
  );
}

/** A labelled field: the label wraps the control; the error (role alert) replaces the hint. */
export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="nx-field">
      <span>{label}</span>
      {children}
      {error ? (
        <span className="nx-tn-bad" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="nx-sub">{hint}</span>
      ) : null}
    </label>
  );
}

/** A switch: a checkbox with role switch, its label and an optional hint. */
export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className="nx-tn-switch nx-check">
      <input type="checkbox" role="switch" checked={checked} aria-checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span>{label}</span>
        {hint ? <small className="nx-sub">{hint}</small> : null}
      </span>
    </label>
  );
}

export function Kv({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="nx-tn-kv">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function Note({ tone, children }: { tone?: "warn" | "bad"; children: ReactNode }) {
  return (
    <div className="nx-tn-note" data-tone={tone} role={tone === "bad" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Status({ tone, children }: { tone: V2Tone; children: ReactNode }) {
  return <Chip tone={TONE[tone]}>{children}</Chip>;
}

/** Where a section needs a permission the viewer lacks. Same words as v2. */
export function NeedsPermission({ what, permission }: { what: string; permission: string }) {
  return <Denied what={what}>{t("{what} needs the {replace} permission. Ask an administrator to grant it.", { what, replace: permission.replace(/_/g, " ") })}</Denied>;
}

/** Loading and failed states of a read; renders `children(data)` once it has data. */
export function Loaded<T>({ q, what, rows = 4, children }: { q: UseQueryResult<T>; what: string; rows?: number; children: (data: T) => ReactNode }) {
  if (q.isError) return <ErrorState sentence={t("{what} could not be read. {apiErrorMessage}", { what, apiErrorMessage: apiErrorMessage(q.error) })} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton lines={rows} label={what} />;
  return <>{children(q.data)}</>;
}

export const since = (iso: string | null | undefined, never = t("Never")): string => (iso ? relTime(iso) : never);

/** Toast that an action went through, with undo when the action can be reversed. */
export function useDone(): (label: string, undo?: () => Promise<unknown>) => void {
  const push = useToast();
  return (label, undo) => push({ text: label, tone: "good", onUndo: undo ? () => void undo() : undefined });
}

export type Outcome = { tone: "ok" | "fail" | "info"; title: string; detail?: string };

/* Outcomes kept per scope for a short while, so a result survives the block re-mounting. */
const KEEP_MS = 20000;
const kept = new Map<string, Outcome>();
const keptListeners = new Set<() => void>();
const keptEmit = () => keptListeners.forEach((l) => l());
const keptSubscribe = (l: () => void) => {
  keptListeners.add(l);
  return () => void keptListeners.delete(l);
};
function keep(scope: string, o: Outcome | null) {
  if (o) {
    kept.set(scope, o);
    setTimeout(() => {
      if (kept.get(scope) === o) {
        kept.delete(scope);
        keptEmit();
      }
    }, KEEP_MS);
  } else kept.delete(scope);
  keptEmit();
}

/** Runs one action at a time and keeps what came of it. */
export function useOutcome(scope?: string) {
  const [local, setLocal] = useState<Outcome | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);
  const scoped = useSyncExternalStore(keptSubscribe, () => (scope ? kept.get(scope) ?? null : null), () => null);
  const outcome = scope ? scoped : local;
  const set = (o: Outcome | null) => {
    if (scope) keep(scope, o);
    else if (alive.current) setLocal(o);
  };
  const run = async (key: string, fn: () => Promise<Outcome | void>) => {
    setPending(key);
    set(null);
    try {
      const o = await fn();
      if (o) set(o);
    } catch (e) {
      set({ tone: "fail", title: t("It did not go through"), detail: failureText(e) });
    } finally {
      if (alive.current) setPending(null);
    }
  };
  return { outcome, pending, run, clear: () => set(null) };
}

export function OutcomeNote({ outcome }: { outcome: Outcome | null }) {
  if (!outcome) return null;
  return (
    <div className="nx-tn-outcome" role={outcome.tone === "fail" ? "alert" : "status"} data-testid="action-result">
      <Chip tone={outcome.tone === "fail" ? "bad" : outcome.tone === "ok" ? "good" : "neutral"}>{outcome.title}</Chip>
      {outcome.detail ? <span>{outcome.detail}</span> : null}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { isAxiosError } from "axios";
import { t } from "@/lib/v2/i18n";
import { EmptyState, ErrorState, Skeleton } from "../kit";

/** Text that may be long (a name, an email): one line, cut with an ellipsis, the whole text in the tooltip. */
export function LongText({ text, className }: { text: string; className?: string }) {
  return <span className={className ? `nx-long ${className}` : "nx-long"} title={text}>{text}</span>;
}

/** The screen for a person who may not use this area: said plainly, with the way forward, never a blank page. */
export function Denied({ what, children }: { what: string; children?: ReactNode }) {
  return (
    <div className="nx-denied" role="alert" data-testid="denied">
      <EmptyState heading={t("You do not have access to {what}", { what })}>
        {children ?? t("Ask an administrator to give your role this permission.")}
      </EmptyState>
    </div>
  );
}

/** True when the failed request was the server ending the session. */
export const isSessionError = (e: unknown): boolean => isAxiosError(e) && e.response?.status === 401;

/**
 * One submit at a time. A second click or Enter while the first is in flight is dropped, not queued. The lock is a ref so
 * two clicks in the same frame still see it.
 */
export function useSubmitGuard(): { busy: boolean; run: (job: () => Promise<void>) => Promise<void> } {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (job: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await job();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

const KEY = (k: string) => `nx_draft:${k}`;
function read<T>(k: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(KEY(k));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Form state that survives the page going away (the session ending mid-form sends the person to sign in, then back). Only
 * the fields the caller passes are stored: never a password or a key. `restored` is true when the value came from a draft.
 */
export function useDraft<T extends object>(key: string, initial: T): { value: T; set: (patch: Partial<T>) => void; clear: () => void; restored: boolean } {
  const [state, setState] = useState<{ value: T; restored: boolean }>({ value: initial, restored: false });
  useEffect(() => {
    const saved = read<T>(key);
    if (saved) setState({ value: { ...initial, ...saved }, restored: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read the stored draft once per key
  }, [key]);
  const set = useCallback(
    (patch: Partial<T>) =>
      setState((s) => {
        const value = { ...s.value, ...patch };
        try {
          window.sessionStorage.setItem(KEY(key), JSON.stringify(value));
        } catch {
          /* storage blocked: the form still works, only the draft is lost */
        }
        return { ...s, value };
      }),
    [key],
  );
  const clear = useCallback(() => {
    try {
      window.sessionStorage.removeItem(KEY(key));
    } catch {
      /* nothing to clear */
    }
    setState({ value: initial, restored: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial is the reset value
  }, [key]);
  return { value: state.value, set, clear, restored: state.restored };
}

/** Shown when a submit failed because the session ended, or when a draft was brought back. */
export function DraftNote({ expired, restored }: { expired?: boolean; restored?: boolean }) {
  if (!expired && !restored) return null;
  return (
    <p className="nx-note" role="status" data-testid="draft-note">
      {expired ? t("Your session ended. Your draft is kept. Sign in again, then send it.") : t("Your draft was kept from before.")}
    </p>
  );
}

const ROW = 44;
const OVERSCAN = 6;

/**
 * A long list drawn in a window: only the rows near the viewport exist in the page, so ten thousand rows cost the same
 * as thirty. Rows are a fixed height. Pair it with a search box so people rarely scroll far.
 */
export function VirtualList<R>({ rows, rowKey, render, label, visible = 12 }: { rows: R[]; rowKey: (r: R) => string; render: (r: R) => ReactNode; label: string; visible?: number }) {
  const [top, setTop] = useState(0);
  const first = Math.max(0, Math.floor(top / ROW) - OVERSCAN);
  const last = Math.min(rows.length, first + visible + OVERSCAN * 2);
  return (
    <div className="nx-vlist" role="list" aria-label={label} style={{ maxHeight: ROW * visible }} onScroll={(e) => setTop(e.currentTarget.scrollTop)} data-testid="vlist" tabIndex={0}>
      <div style={{ height: rows.length * ROW, position: "relative" }}>
        {rows.slice(first, last).map((r, i) => (
          <div key={rowKey(r)} role="listitem" className="nx-vrow" style={{ top: (first + i) * ROW, height: ROW }}>{render(r)}</div>
        ))}
      </div>
    </div>
  );
}

/** The search box that goes above a long list. */
export function ListSearch({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return <input type="search" className="nx-input nx-search" aria-label={label} placeholder={label} value={value} onChange={(e) => onChange(e.target.value)} />;
}

/** The four states of any loaded list, each a real screen: skeleton while loading, a sentence with Retry on error, the empty screen, else the content. */
export function QueryView({ loading, error, onRetry, empty, emptyHeading, emptyText, emptyAction, label, children }: {
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  empty: boolean;
  emptyHeading: string;
  emptyText?: string;
  emptyAction?: ReactNode;
  label: string;
  children: ReactNode;
}) {
  if (loading) return <Skeleton lines={5} label={label} />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (empty) return <EmptyState heading={emptyHeading} action={emptyAction}>{emptyText}</EmptyState>;
  return <>{children}</>;
}

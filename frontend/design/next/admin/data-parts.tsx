"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { apiErrorMessage } from "@/lib/error";
import { relTime } from "@/lib/v2/format";
import { failureText } from "@/lib/v2/errors";
import { useV2Session } from "@/lib/v2/hooks";
import { usePermissions } from "@/lib/permissions";
import { requestTargetFor } from "@/lib/rbac";
import { t } from "@/lib/v2/i18n";
import { Button, ErrorState, Skeleton, useToast } from "../kit";
import "./data.css";

/** v2 status tones mapped to kit chip tones. */
export const TONE = { go: "good", "at-risk": "warn", "no-go": "bad", neutral: "neutral" } as const;

export const useCan = (): ((action: string) => boolean) => useV2Session().can;

/** A relative time, or the word for never. */
export const since = (iso: string | null | undefined, never = t("Never")): string => (iso ? relTime(iso) : never);

/** An empty cell, with the reason as its tooltip. */
export function Dash({ why }: { why?: string }) {
  return <span title={why}>{"—"}</span>;
}

/** A titled block of one data section: heading, one-line hint, optional actions, then the body. */
export function DataBlock({ title, hint, actions, children, testid }: { title?: string; hint?: ReactNode; actions?: ReactNode; children?: ReactNode; testid?: string }) {
  return (
    <section className="nx-data-block" aria-label={title} data-testid={testid}>
      {title || hint || actions ? (
        <div className="nx-data-head">
          <div>
            {title ? <h2 className="nx-data-h2">{title}</h2> : null}
            {hint ? <p className="nx-sub">{hint}</p> : null}
          </div>
          {actions ? <div className="nx-data-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** One data section: the lead line, optional actions, then the blocks. */
export function DataPage({ lead, actions, children }: { lead?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="nx-body nx-data">
      {lead || actions ? (
        <div className="nx-data-head">
          {lead ? <p className="nx-sub">{lead}</p> : <span />}
          {actions ? <div className="nx-data-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** A query's three states: the error sentence with Retry, a skeleton while it reads, then the data. */
export function DataLoaded<T>({ q, what, rows = 4, children }: { q: UseQueryResult<T>; what: string; rows?: number; children: (data: T) => ReactNode }) {
  if (q.isError) return <ErrorState sentence={t("{what} could not be read. {apiErrorMessage}", { what, apiErrorMessage: apiErrorMessage(q.error) })} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton lines={rows} label={what} />;
  return <>{children(q.data)}</>;
}

/** Label and value pairs. */
export function Notes({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="nx-notes">
      {rows.map(([k, v], i) => [<dt key={`k${i}`}>{k}</dt>, <dd key={`v${i}`}>{v}</dd>])}
    </dl>
  );
}

/** A labelled form field with its hint, or its error in place of the hint. */
export function Field({ label, hint, error, children, wide }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`nx-field${wide ? " nx-data-wide" : ""}`}>
      <span>{label}</span>
      {children}
      {error ? (
        <span className="nx-data-bad" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="nx-sub">{hint}</span>
      ) : null}
    </label>
  );
}

/** A checkbox switch with its label and hint. */
export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className="nx-data-toggle">
      <input type="checkbox" className="nx-check" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint ? <small className="nx-sub">{hint}</small> : null}
      </span>
    </label>
  );
}

/** The viewer lacks a permission: say which and offer the request-access dialog (POST /me/access-requests). */
export function NeedsPermission({ what, permission }: { what: string; permission: string }) {
  const { requestAccess } = usePermissions();
  return (
    <div className="nx-note" data-testid="needs-permission">
      <p>{t("{what} needs the {replace} permission. Ask an administrator to grant it.", { what, replace: permission.replace(/_/g, " ") })}</p>
      <Button size={32} data-testid="request-access" onClick={() => requestAccess(requestTargetFor({ resource: null, action: permission }))}>
        {t("Request access")}
      </Button>
    </div>
  );
}

/** Offset paging under a table. */
export function Pager({ offset, limit, total, onPage }: { offset: number; limit: number; total: number; onPage: (offset: number) => void }) {
  if (total <= limit) return <p className="nx-sub">{t("{total} {total, plural, one {entry} other {entries}}", { total })}</p>;
  return (
    <div className="nx-data-actions">
      <span className="nx-sub">{t("{count} to {min} of {total}", { count: offset + 1, min: Math.min(total, offset + limit), total })}</span>
      <Button size={32} disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - limit))}>
        {t("Previous")}
      </Button>
      <Button size={32} disabled={offset + limit >= total} onClick={() => onPage(offset + limit)}>
        {t("Next")}
      </Button>
    </div>
  );
}

/** One action at a time, keyed so the right button shows its busy label. The job returns the success sentence;
 * a failure shows "It did not go through" with the reason. Returns true when the job finished. */
export function useAct(): { pending: string | null; act: (key: string, job: () => Promise<string | undefined | void>) => Promise<boolean> } {
  const toast = useToast();
  const lock = useRef(false);
  const [pending, setPending] = useState<string | null>(null);
  const act = useCallback(
    async (key: string, job: () => Promise<string | undefined | void>) => {
      if (lock.current) return false;
      lock.current = true;
      setPending(key);
      try {
        const text = await job();
        if (text) toast({ text, tone: "good" });
        return true;
      } catch (e) {
        toast({ text: `${t("It did not go through")}. ${failureText(e)}`, tone: "bad" });
        return false;
      } finally {
        lock.current = false;
        setPending(null);
      }
    },
    [toast],
  );
  return { pending, act };
}

"use client";
/* Shared layout pieces for the notify admin group. Native rebuild of the v2 admin Block, Kv and Loaded. */
import { Fragment, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { apiErrorMessage } from "@/lib/error";
import { t } from "@/lib/v2/i18n";
import { ErrorState, Skeleton } from "../kit";
import "./notify.css";

export const TONE = { go: "good", "at-risk": "warn", "no-go": "bad", neutral: "neutral" } as const;

export function NotifyPage({ lead, actions, children }: { lead?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="nx-body nx-notify">
      {lead || actions ? (
        <div className="nx-notify-head">
          <div>{lead ? <p className="nx-sub">{lead}</p> : null}</div>
          {actions ? <div className="nx-notify-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function NotifyBlock({ title, hint, actions, children, testid }: { title: string; hint?: ReactNode; actions?: ReactNode; children: ReactNode; testid?: string }) {
  return (
    <section className="nx-notify-block" aria-label={title} data-testid={testid}>
      <div className="nx-notify-head">
        <div>
          <h2 className="nx-notify-h2">{title}</h2>
          {hint ? <p className="nx-sub">{hint}</p> : null}
        </div>
        {actions ? <div className="nx-notify-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function NotifyLoaded<T>({ q, what, rows = 4, children }: { q: UseQueryResult<T>; what: string; rows?: number; children: (d: T) => ReactNode }) {
  if (q.isError) return <ErrorState sentence={t("{what} could not be read. {apiErrorMessage}", { what, apiErrorMessage: apiErrorMessage(q.error) })} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton lines={rows} label={what} />;
  return <>{children(q.data)}</>;
}

export function Kv({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="nx-notify-kv">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function Bad({ children }: { children: ReactNode }) {
  return <p className="nx-note nx-notify-bad" role="alert">{children}</p>;
}

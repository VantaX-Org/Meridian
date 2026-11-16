"use client";

import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { apiErrorMessage } from "@/lib/error";
import { t } from "@/lib/v2/i18n";
import { ErrorState, Skeleton } from "../kit";
import "./ops.css";

/** v2 status tones mapped to kit chip tones. */
export const TONE = { go: "good", "at-risk": "warn", "no-go": "bad", neutral: "neutral" } as const;
export type V2Tone = keyof typeof TONE;

/** A titled block of one ops section: heading, one-line hint, optional actions, then the body. */
export function OpsBlock({ title, hint, actions, children, testid }: { title?: string; hint?: string; actions?: ReactNode; children: ReactNode; testid?: string }) {
  return (
    <section className="nx-ops-block" aria-label={title} data-testid={testid}>
      {title || hint || actions ? (
        <div className="nx-ops-head">
          <div>
            {title ? <h2 className="nx-ops-h2">{title}</h2> : null}
            {hint ? <p className="nx-sub">{hint}</p> : null}
          </div>
          {actions ? <div className="nx-ops-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** One ops section: the lead line, optional actions, then the blocks. */
export function OpsPage({ lead, actions, children }: { lead?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="nx-body nx-ops">
      {lead || actions ? (
        <div className="nx-ops-head">
          {lead ? <p className="nx-sub">{lead}</p> : <span />}
          {actions ? <div className="nx-ops-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** A query's three states as v2 Loaded had them: the error sentence with Retry, a skeleton while it reads, then the data. */
export function OpsLoaded<T>({ q, what, rows = 4, children }: { q: UseQueryResult<T>; what: string; rows?: number; children: (data: T) => ReactNode }) {
  if (q.isError) return <ErrorState sentence={t("{what} could not be read. {apiErrorMessage}", { what, apiErrorMessage: apiErrorMessage(q.error) })} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton lines={rows} label={what} />;
  return <>{children(q.data)}</>;
}

/** Label and value pairs, as v2 Kv. */
export function Notes({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="nx-notes">
      {rows.map(([k, v], i) => [<dt key={`k${i}`}>{k}</dt>, <dd key={`v${i}`}>{v}</dd>])}
    </dl>
  );
}

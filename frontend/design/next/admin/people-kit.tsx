"use client";

import { useState, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { writeClipboard } from "@/lib/browser";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { relTime } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { Button, ErrorState, Skeleton } from "../kit";
import "./people.css";

/** v2 status tones mapped to kit chip tones. */
export const TONE = { go: "good", "at-risk": "warn", "no-go": "bad", neutral: "neutral" } as const;

/** A titled block of one people section: heading, one-line hint, optional actions, then the body. */
export function Block({ title, hint, actions, children, testid }: { title?: string; hint?: string; actions?: ReactNode; children: ReactNode; testid?: string }) {
  return (
    <section className="nx-ppl-block" aria-label={title} data-testid={testid}>
      {title || hint || actions ? (
        <div className="nx-ppl-head">
          <div>
            {title ? <h2 className="nx-ppl-h2">{title}</h2> : null}
            {hint ? <p className="nx-sub">{hint}</p> : null}
          </div>
          {actions ? <div className="nx-ppl-acts">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** One section: the lead line, optional actions, then the blocks. */
export function Page({ lead, actions, children }: { lead?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="nx-body nx-ppl">
      {lead || actions ? (
        <div className="nx-ppl-head">
          {lead ? <p className="nx-sub">{lead}</p> : <span />}
          {actions ? <div className="nx-ppl-acts">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** A query's three states as v2 Loaded had them. */
export function Loaded<T>({ q, what, rows = 4, children }: { q: UseQueryResult<T>; what: string; rows?: number; children: (data: T) => ReactNode }) {
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

/** A relative time with the full date on hover, or the never word. */
export function Since({ at, never }: { at: string | null | undefined; never?: string }) {
  if (!at) return <>{never ?? t("Never")}</>;
  return <time dateTime={at} title={formatDate(at, "datetime")}>{relTime(at)}</time>;
}

/** A labelled field with an optional hint and error, as v2 Fld. */
export function Field({ label, hint, error, wide, children }: { label: string; hint?: string; error?: string | null; wide?: boolean; children: ReactNode }) {
  return (
    <label className="nx-field" data-wide={wide || undefined}>
      <span>{label}</span>
      {children}
      {hint ? <span className="nx-sub">{hint}</span> : null}
      {error ? <span className="nx-ppl-bad" role="alert">{error}</span> : null}
    </label>
  );
}

/** A switch with its label and hint, as v2 Sw. */
export function Switch({ checked, onChange, disabled, label, hint }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; hint?: string }) {
  return (
    <label className="nx-ppl-switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span>{label}</span>
        {hint ? <span className="nx-sub">{hint}</span> : null}
      </span>
    </label>
  );
}

/** A copy button that says Copied once the browser took the text. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <>
      <Button size={32} onClick={() => void writeClipboard(text).then(setCopied)}>{copied ? t("Copied") : label}</Button>
      {copied === false ? <span className="nx-sub" role="alert">{t("The browser did not allow copying. Select the token and copy it by hand.")}</span> : null}
    </>
  );
}

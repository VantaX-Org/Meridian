"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { failureText } from "@/lib/v2/errors";
import { formatDate } from "@/lib/format";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import type { WorkflowTask } from "@/lib/api/v2/requests";
import { V2Link } from "@/design/v2/parts";
import { Chip } from "../../kit";
import "./work.css";

/** What an action answered, kept in the inspector it was started from. */
export interface Outcome {
  tone: "ok" | "fail" | "info";
  title: string;
  detail?: string;
  /** A job the action started: the line links to its inspector. */
  job?: string | null;
}

/** One action at a time: `run(key, fn)` marks the key pending, then keeps what `fn` returned, or the API's own sentence. */
export function useOutcome(): { outcome: Outcome | null; pending: string | null; run: (key: string, fn: () => Promise<Outcome>) => Promise<void>; clear: () => void } {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(async (key: string, fn: () => Promise<Outcome>) => {
    setPending(key);
    setOutcome(null);
    try {
      const next = await fn();
      if (alive.current) setOutcome(next);
    } catch (e) {
      if (alive.current) setOutcome({ tone: "fail", title: t("It did not go through"), detail: failureText(e) });
    } finally {
      if (alive.current) setPending(null);
    }
  }, []);
  const clear = useCallback(() => setOutcome(null), []);
  return { outcome, pending, run, clear };
}

/** An action's answer in place of a toast: a chip with the word, what the system said, and the job it started. */
export function OutcomeLine({ outcome, children }: { outcome: Outcome; children?: ReactNode }) {
  const { hrefFor } = useOpenItem();
  return (
    <div className="nx-wk-result" role="status" data-tone={outcome.tone} data-testid="action-result">
      <Chip tone={outcome.tone === "ok" ? "good" : outcome.tone === "fail" ? "bad" : "neutral"}>{outcome.title}</Chip>
      {outcome.detail ? <span>{outcome.detail}</span> : null}
      {outcome.job ? <V2Link href={hrefFor({ kind: "job", id: outcome.job })}>{t("Open the job")}</V2Link> : null}
      {children}
    </div>
  );
}

/** A missing value: a dash, with why in the tooltip. */
export function Dash({ why }: { why?: string }) {
  return <span className="nx-wk-dash" title={why}>{"—"}</span>;
}

/** A titled section of the inspector body. */
export function Sec({ title, children, testId, label }: { title: string; children: ReactNode; testId?: string; label?: string }) {
  return (
    <section className="nx-ib-sec" data-testid={testId} aria-label={label}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/** A sentence beside an action, in the quiet face. */
export function Note({ children, id }: { children: ReactNode; id?: string }) {
  return <p className="nx-ib-meta nx-wk-note" id={id}>{children}</p>;
}

const TASK_WORD = (s: string): string => ({ pending: t("Waiting"), approved: t("Approved"), rejected: t("Rejected"), skipped: t("Skipped"), cancelled: t("Cancelled") })[s] ?? s;

/** The steps of an approval workflow: each step, its state, who decided it and when, or when it falls due. */
export function WorkflowSteps({ tasks, testId }: { tasks: WorkflowTask[]; testId: string }) {
  return (
    <ol className="nx-ib-list" data-testid={testId}>
      {tasks.map((s) => (
        <li key={s.id}>
          <div>
            {`${s.step_name}: ${TASK_WORD(s.status)}`}
            {s.decided_by_label ? t(" by {user}", { user: s.decided_by_label }) : ""}
          </div>
          {s.comment ? <p className="nx-wk-quote">{s.comment}</p> : null}
          {s.skip_reason ? <p className="nx-wk-quote">{s.skip_reason}</p> : null}
          <div className="nx-ib-meta">{s.decided_at ? formatDate(s.decided_at, "datetime") : s.due_at ? t("Due {due}", { due: formatDate(s.due_at, "datetime") }) : "—"}</div>
        </li>
      ))}
    </ol>
  );
}

/** Mirrors BasisHome's test: a refused sign-in or authorisation, which a retry does not fix. */
const AUTH = /\b(401|403)\b|unauthori[sz]ed|not authori[sz]ed|authori[sz]ation|credential|S_TABU_DIS|S_RFC|RFC_NO_AUTHORITY|NO_AUTHORITY|logon|password/i;
export const isAuthError = (text: string | null | undefined): boolean => Boolean(text && AUTH.test(text));

/** "11 m 42 s" from seconds, as the v2 status strip writes it. */
export function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m} m ${s} s` : `${s} s`;
}

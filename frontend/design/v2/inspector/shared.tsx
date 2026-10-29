"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { apiErrorMessage } from "@/lib/error";
import { useOpenItem } from "@/lib/v2/hooks";
import { VerdictMark } from "../marks";
import { V2Link } from "../parts";

/** What an action answered, kept in the frame it was started from. */
export interface Outcome {
  tone: "ok" | "fail" | "info";
  title: string;
  detail?: string;
  /** A job the action started: the frame links to its inspector. */
  job?: string | null;
}

/** An action's result in place of a toast: a mark and a word, what the system said, and the job it started. */
export function ResultFrame({ outcome, children }: { outcome: Outcome; children?: ReactNode }) {
  const { hrefFor } = useOpenItem();
  return (
    <div className="m2-result" role="status" data-tone={outcome.tone} data-testid="action-result">
      <span className="m2-result-t">
        {outcome.tone === "ok" ? <VerdictMark verdict="go" /> : outcome.tone === "fail" ? <VerdictMark verdict="no-go" /> : null}
        {outcome.title}
      </span>
      {outcome.detail ? <span>{outcome.detail}</span> : null}
      {outcome.job ? (
        <span>
          <V2Link href={hrefFor({ kind: "job", id: outcome.job })}>Open the job</V2Link>
        </span>
      ) : null}
      {children}
    </div>
  );
}

/**
 * One action at a time: `run(key, fn)` marks the key pending, then keeps what `fn` returned (or the error's message,
 * which is the API's own sentence) as the outcome to show.
 */
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
      if (alive.current) setOutcome({ tone: "fail", title: "It did not go through", detail: apiErrorMessage(e) });
    } finally {
      if (alive.current) setPending(null);
    }
  }, []);
  const clear = useCallback(() => setOutcome(null), []);
  return { outcome, pending, run, clear };
}

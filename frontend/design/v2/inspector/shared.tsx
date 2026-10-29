"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { failureText } from "@/lib/v2/errors";
import { useOpenItem } from "@/lib/v2/hooks";
import { VerdictMark } from "../marks";
import { V2Link } from "../parts";
import { t } from "@/lib/v2/i18n";

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
          <V2Link href={hrefFor({ kind: "job", id: outcome.job })}>{t("Open the job")}</V2Link>
        </span>
      ) : null}
      {children}
    </div>
  );
}

/** Outcomes kept by name, for a form that is drawn again when its saved data changes: the answer must outlive that. */
const kept = new Map<string, Outcome | null>();
const listeners = new Set<() => void>();
const KEEP_MS = 20_000;
const subscribeKept = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
function keep(scope: string, outcome: Outcome | null): void {
  kept.set(scope, outcome);
  listeners.forEach((l) => l());
  if (outcome) {
    // A kept answer is for the moment after the action, not for next week.
    setTimeout(() => {
      if (kept.get(scope) === outcome) {
        kept.delete(scope);
        listeners.forEach((l) => l());
      }
    }, KEEP_MS);
  }
}

/** Test seam: forget every kept outcome. */
export function resetKeptOutcomes(): void {
  kept.clear();
  listeners.forEach((l) => l());
}

/**
 * One action at a time: `run(key, fn)` marks the key pending, then keeps what `fn` returned (or the error's message,
 * which is the API's own sentence) as the outcome to show. With a `scope`, the outcome is kept by that name, so a form
 * that remounts when the data it saved arrives still shows what the save answered.
 */
export function useOutcome(scope?: string): { outcome: Outcome | null; pending: string | null; run: (key: string, fn: () => Promise<Outcome>) => Promise<void>; clear: () => void } {
  const [local, setLocal] = useState<Outcome | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const shared = useSyncExternalStore(subscribeKept, () => (scope ? (kept.get(scope) ?? null) : null), () => null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const put = useCallback(
    (o: Outcome | null, force: boolean) => {
      if (scope) keep(scope, o);
      else if (force || alive.current) setLocal(o);
    },
    [scope],
  );
  const run = useCallback(
    async (key: string, fn: () => Promise<Outcome>) => {
      setPending(key);
      put(null, false);
      try {
        const next = await fn();
        put(next, false);
      } catch (e) {
        put({ tone: "fail", title: t("It did not go through"), detail: failureText(e) }, false);
      } finally {
        if (alive.current) setPending(null);
      }
    },
    [put],
  );
  const clear = useCallback(() => put(null, true), [put]);
  return { outcome: scope ? shared : local, pending, run, clear };
}

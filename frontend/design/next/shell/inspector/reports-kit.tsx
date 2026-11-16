"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { failureText } from "@/lib/v2/errors";
import { t } from "@/lib/v2/i18n";
import { usePermissions } from "@/lib/permissions";
import { requestTargetFor } from "@/lib/rbac";
import { Button, Chip, useToast } from "../../kit";
import "./reports.css";

/** What an action answered, kept in the frame it was started from. */
export interface Outcome {
  tone: "ok" | "fail" | "info";
  title: string;
  detail?: string;
}

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
    setTimeout(() => {
      if (kept.get(scope) === outcome) {
        kept.delete(scope);
        listeners.forEach((l) => l());
      }
    }, KEEP_MS);
  }
}

/** Test seam: forget every kept outcome. */
export function resetReportOutcomes(): void {
  kept.clear();
  listeners.forEach((l) => l());
}

/**
 * One action at a time: `run(key, fn)` marks the key pending, then keeps what `fn` returned (or the API's own sentence
 * on failure). With a `scope`, the outcome outlives a remount of the form that saved it.
 */
export function useOutcome(scope?: string): { outcome: Outcome | null; pending: string | null; run: (key: string, fn: () => Promise<Outcome>) => Promise<void> } {
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
    (o: Outcome | null) => {
      if (scope) keep(scope, o);
      else if (alive.current) setLocal(o);
    },
    [scope],
  );
  const run = useCallback(
    async (key: string, fn: () => Promise<Outcome>) => {
      setPending(key);
      put(null);
      try {
        put(await fn());
      } catch (e) {
        put({ tone: "fail", title: t("It did not go through"), detail: failureText(e) });
      } finally {
        if (alive.current) setPending(null);
      }
    },
    [put],
  );
  return { outcome: scope ? shared : local, pending, run };
}

/** An action's result in place of a toast. */
export function Result({ outcome }: { outcome: Outcome | null }) {
  if (!outcome) return null;
  return (
    <div className="nx-rp-result" role="status" data-tone={outcome.tone} data-testid="action-result">
      <Chip tone={outcome.tone === "ok" ? "good" : outcome.tone === "fail" ? "bad" : "neutral"}>{outcome.title}</Chip>
      {outcome.detail ? <span>{outcome.detail}</span> : null}
    </div>
  );
}

export function NeedsPermission({ what, permission }: { what: string; permission: string }) {
  const { requestAccess } = usePermissions();
  return (
    <div className="nx-rp-perm" data-testid="needs-permission">
      <p>{t("{what} needs the {replace} permission. Ask an administrator to grant it.", { what, replace: permission.replace(/_/g, " ") })}</p>
      <Button size={32} data-testid="request-access" onClick={() => requestAccess(requestTargetFor({ resource: null, action: permission }))}>
        {t("Request access")}
      </Button>
    </div>
  );
}

/** A missing value, with why it is missing on hover and for assistive technology. */
export function Dash({ why }: { why: string }) {
  return (
    <span title={why} aria-label={why}>
      —
    </span>
  );
}

/** A done toast with an optional undo. */
export function useDone(): (label: string, undo?: () => Promise<unknown>) => void {
  const toast = useToast();
  return (label, undo) => toast({ text: label, tone: "good", onUndo: undo ? () => void undo() : undefined });
}

/** A labelled form field in kit style. */
export function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="nx-field">
      <span>{label}</span>
      {children}
      {hint ? <span className="nx-rp-sub">{hint}</span> : null}
      {error ? (
        <span className="nx-rp-err" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

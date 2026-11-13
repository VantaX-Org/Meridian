"use client";

/** The states every Load screen shares: compact counts, long names, a stale-data nudge, permission denied and a double-submit guard. */
import { useCallback, useRef, useState } from "react";
import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { Button, EmptyState } from "../kit";

/** Whole numbers up to 9,999 in full; above that compact ("1.2M"), so a very large count never breaks a row. */
export function compactInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) < 10_000) return formatInt(n);
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** A name cut with an ellipsis; the full name stays in the tooltip and is read by screen readers. */
export function Trunc({ text, max = 28 }: { text: string; max?: number }) {
  return (
    <span className="nx-trunc" style={{ maxInlineSize: `${max}ch` }} title={text.length > max ? text : undefined} data-testid="trunc">
      {text}
    </span>
  );
}

/** "A newer run exists": shown when the thing on screen is not the newest. */
export function StaleNudge({ newer, onOpen }: { newer: string; onOpen: () => void }) {
  return (
    <aside className="nx-stale" role="status" data-testid="stale-nudge">
      <p>{t("A newer run exists: {run}. What you see may be out of date.", { run: newer })}</p>
      <Button variant="secondary" onClick={onOpen}>{t("Switch to the newer run")}</Button>
    </aside>
  );
}

/** Permission denied, as a screen: what is missing, and who can give it. */
export function Denied({ right }: { right: string }) {
  return (
    <div data-testid="denied">
      <EmptyState icon="alert" heading={t("You do not have access to this")}>
        {t("This needs the {right} right. Ask an administrator of your workspace to give it to you.", { right })}
      </EmptyState>
    </div>
  );
}

/** Runs an async action once at a time: a second click while the first is in flight does nothing. */
export function useGuard(): { busy: boolean; run: (fn: () => Promise<unknown>) => Promise<void> } {
  const flying = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    if (flying.current) return;
    flying.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      flying.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, run };
}


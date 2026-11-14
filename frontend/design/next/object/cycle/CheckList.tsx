"use client";

/** A list of checks with a status in words (never colour alone), and the "Checks before this step" gate list. */
import { t } from "@/lib/v2/i18n";
import type { CheckStatus } from "./uploadGate";

export interface CheckRow { id: string; label: string; status: CheckStatus; detail?: string }

export const statusWord = (s: CheckStatus): string => (s === "pass" ? t("Passed") : s === "warn" ? t("Warning") : t("Failed"));

export function CheckList({ rows, label, testid = "check-list" }: { rows: CheckRow[]; label: string; testid?: string }) {
  return (
    <ul className="nx-ck" aria-label={label} data-testid={testid}>
      {rows.map((r) => (
        <li key={r.id} className="nx-ck-row" data-status={r.status} data-testid={`check-${r.id}`}>
          <span className="nx-ck-word">{statusWord(r.status)}</span>
          <span className="nx-ck-label">{r.label}</span>
          {r.detail ? <span className="nx-ck-detail">{r.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** What must hold before a step: a fail blocks the step's action, a warning does not. */
export function GateList({ rows }: { rows: CheckRow[] }) {
  return (
    <section className="nx-gate" aria-label={t("Checks before this step")} data-testid="gate-list">
      <h3 className="nx-gate-h">{t("Checks before this step")}</h3>
      <CheckList rows={rows} label={t("Checks before this step")} testid="gate-rows" />
    </section>
  );
}

export const blocked = (rows: CheckRow[]): CheckRow | undefined => rows.find((r) => r.status === "fail");

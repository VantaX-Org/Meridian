import type { ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { Dash } from "../parts";

/* Stage 5 parts for the Rules and Aletheia screens. Kept in one file so no shared component changes. */

/**
 * The verified mark: a verdigris ring with a check, then the word. Show it only where a fact was checked at run level
 * (the run's agents completed). Per-finding verification is a backend gap, so it is never shown per row.
 */
export function VerifiedMark({ children }: { children?: ReactNode }) {
  return (
    <span className="m2-verified" data-testid="verified-mark" style={{ display: "inline-flex", alignItems: "center", gap: "var(--m2-s2)" }}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
        <circle cx="7" cy="7" r="6" fill="none" stroke="var(--m2-ai)" strokeWidth="1.5" style={{ filter: "drop-shadow(0 0 2px var(--m2-glow-ai))" }} />
        <path d="M4.2 7.2 6.2 9.2 9.9 5.2" fill="none" stroke="var(--m2-ai)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{children ?? t("Verified")}</span>
    </span>
  );
}

/** Findings across more than two runs: no endpoint gives it per rule, so the cell is a dash that says why. */
export function RibbonDash() {
  return <Dash why={t("Findings for one rule across several runs are not available yet. Open the rule to see the newest run.")} />;
}

/** Where the user is in multi-step work: done steps, the current one (aria-current) and what follows. */
export function Steps({ steps, current, label, testId }: { steps: string[]; current: number; label: string; testId?: string }) {
  return (
    <ol aria-label={label} data-testid={testId} style={{ display: "flex", flexWrap: "wrap", gap: "var(--m2-s4)", listStyle: "none", padding: 0, margin: 0 }}>
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "next";
        return (
          <li key={s} aria-current={state === "current" ? "step" : undefined} data-state={state} style={{ display: "flex", alignItems: "center", gap: "var(--m2-s2)", opacity: state === "next" ? 0.6 : 1, fontWeight: state === "current" ? 600 : 400 }}>
            <span aria-hidden="true" style={{ display: "inline-grid", placeItems: "center", width: 20, height: 20, borderRadius: "50%", border: "1px solid var(--m2-data)", background: state === "done" ? "var(--m2-data)" : "transparent", fontSize: "var(--m2-fs-12)" }}>{i + 1}</span>
            <span>{s}</span>
            <span className="m2-sr">{state === "done" ? t("done") : state === "current" ? t("current step") : t("next")}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** What an action will do, said before it runs. */
export function Consequence({ children }: { children: ReactNode }) {
  return <p className="m2-why1" data-testid="consequence">{children}</p>;
}

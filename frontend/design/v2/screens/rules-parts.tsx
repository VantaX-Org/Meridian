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

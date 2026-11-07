import type { ReactNode } from "react";
import { int } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { Sparkline } from "../charts/Sparkline";
import { Consequence, FlowSteps } from "../FixParts";
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

/** One rule's failing records across a system's latest runs, oldest first. A null is a run where the rule did not run. */
export function RuleRibbon({ values }: { values?: readonly (number | null)[] }) {
  const ran = (values ?? []).filter((v): v is number => v != null);
  if (!ran.length) return <Dash why={t("No runs of this rule in this system yet.")} />;
  const label = t("Failing records over the last {count} runs: {first} to {last}", { count: ran.length, first: int(ran[0]), last: int(ran[ran.length - 1]) });
  return <Sparkline values={values as (number | null)[]} width={80} height={16} domain={[0, Math.max(1, ...ran)]} label={label} />;
}

/** The shared step strip, for rule screens whose steps are labels only. */
export function Steps({ steps, ...rest }: { steps: string[]; current: number; label: string; testId?: string }) {
  return <FlowSteps steps={steps.map((label) => ({ label }))} {...rest} />;
}

export { Consequence };

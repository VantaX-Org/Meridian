import type { Verdict } from "@/lib/api/v2/types";

export type SeverityKey = "critical" | "high" | "medium" | "low" | "info";

/** Verdict mark: circle go, triangle at risk, square no-go. Always drawn beside the word. */
export function VerdictMark({ verdict }: { verdict: Verdict }) {
  const cls = verdict === "go" ? "go" : verdict === "at-risk" ? "risk" : "nogo";
  return (
    <svg className={`m2-vm ${cls}`} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      {verdict === "go" ? <circle cx="5" cy="5" r="4" /> : verdict === "at-risk" ? <path d="M5 .8 9.4 9H.6Z" /> : <rect x="1" y="1" width="8" height="8" rx="1" />}
    </svg>
  );
}

/** Severity mark: square critical, triangle high, ring medium and low. */
export function SeverityMark({ severity }: { severity: SeverityKey }) {
  const cls = severity === "critical" ? "crit" : severity === "high" ? "high" : severity === "medium" ? "med" : "low";
  return (
    <svg className={`m2-vm ${cls}`} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      {severity === "critical" ? <rect x="1" y="1" width="8" height="8" rx="1" /> : severity === "high" ? <path d="M5 .8 9.4 9H.6Z" /> : <circle cx="5" cy="5" r="3.4" />}
    </svg>
  );
}

const STROKE = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function IconChevron({ open }: { open?: boolean }) {
  return (
    <svg className="m2-chev" data-open={open ? "true" : undefined} width="14" height="14" viewBox="0 0 16 16" strokeWidth="1.5" aria-hidden="true" {...STROKE}>
      <path d="m6 4 4 4-4 4" />
    </svg>
  );
}

export function IconDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" strokeWidth="1.5" aria-hidden="true" {...STROKE}>
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

export function IconSearch() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" strokeWidth="1.5" aria-hidden="true" {...STROKE}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  );
}

export function IconClose() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" strokeWidth="1.5" aria-hidden="true" {...STROKE}>
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

export function IconCheck() {
  return (
    <svg className="m2-ck" width="14" height="14" viewBox="0 0 16 16" strokeWidth="1.75" aria-hidden="true" {...STROKE}>
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}

/** The mark: a diamond with a meridian line, in the data hue. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg className="m2-mark" width={size} height={size} viewBox="0 0 24 24" strokeWidth="1.75" aria-hidden="true" {...STROKE}>
      <path d="M12 2.5 21.5 12 12 21.5 2.5 12Z" />
      <path d="M12 2.5C7.6 7.6 7.6 16.4 12 21.5" />
    </svg>
  );
}

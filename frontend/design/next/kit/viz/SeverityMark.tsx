import "./charts.css";

export type SeverityKey = "critical" | "high" | "medium" | "low" | "info";

/** Severity mark: square critical, triangle high, ring medium and low. Always drawn beside the word. */
export function SeverityMark({ severity }: { severity: SeverityKey }) {
  const level = severity === "critical" || severity === "high" || severity === "medium" ? severity : "low";
  return (
    <svg className="nx-sevmark" data-severity={level} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      {level === "critical" ? <rect x="1" y="1" width="8" height="8" rx="1" /> : level === "high" ? <path d="M5 .8 9.4 9H.6Z" /> : <circle cx="5" cy="5" r="3.4" />}
    </svg>
  );
}

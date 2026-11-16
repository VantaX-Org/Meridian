import type { Severity } from "./SeverityStrip";

/** A severity as a dot and its label. The label is passed in so it is already translated. */
export function SeverityPill({ sev, label }: { sev: Severity; label: string }) {
  return <span className="mx-sev" data-sev={sev}><i className="mx-dot" aria-hidden="true" />{label}</span>;
}

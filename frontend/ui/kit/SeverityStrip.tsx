export type Severity = "critical" | "high" | "medium" | "low" | "info";
export interface SeverityTile { sev: Severity; label: string; rules: number; records: string }

/** A strip of tiles, one per severity: failing rule count and affected records. */
export function SeverityStrip({ tiles, rulesLabel }: { tiles: SeverityTile[]; rulesLabel: (n: number) => string }) {
  return (
    <dl className="mx-sevstrip">
      {tiles.map((x) => (
        <div key={x.sev} data-sev={x.sev}>
          <dt><i className="mx-dot" aria-hidden="true" />{x.label}</dt>
          <dd className="mx-sevstrip-n">{x.rules}</dd>
          <dd className="mx-muted">{rulesLabel(x.rules)}</dd>
          <dd className="mx-muted">{x.records}</dd>
        </div>
      ))}
    </dl>
  );
}

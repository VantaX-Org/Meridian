import { t } from "@/lib/v2/i18n";
import { whole } from "@/lib/v2/format";

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export interface SeverityTile { sev: Severity; label: string; rules: number; records: string }

/** A strip of tiles, one per severity: failing rule count and affected records. With `onSelect` each tile is a filter button; hover shows the count and its share of all failing rules. */
export function SeverityStrip({ tiles, rulesLabel, onSelect, selected }: { tiles: SeverityTile[]; rulesLabel: (n: number) => string; onSelect?: (sev: Severity) => void; selected?: Severity | null }) {
  const total = tiles.reduce((a, x) => a + x.rules, 0);
  return (
    <dl className="mx-sevstrip">
      {tiles.map((x) => (
        <div key={x.sev} data-sev={x.sev} data-link={onSelect ? "" : undefined} data-selected={selected === x.sev ? "true" : undefined}
          title={t("{label}: {n} failing rules, {p}% of all", { label: x.label, n: whole(x.rules), p: whole(total ? Math.round((x.rules / total) * 100) : 0) })}>
          <dt>{onSelect ? <button type="button" className="mx-hit" aria-pressed={selected === x.sev} onClick={() => onSelect(x.sev)}><i className="mx-dot" aria-hidden="true" />{x.label}</button> : <><i className="mx-dot" aria-hidden="true" />{x.label}</>}</dt>
          <dd className="mx-sevstrip-n">{x.rules}</dd>
          <dd className="mx-muted">{rulesLabel(x.rules)}</dd>
          <dd className="mx-muted">{x.records}</dd>
        </div>
      ))}
    </dl>
  );
}

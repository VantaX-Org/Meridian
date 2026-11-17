import type { Severity } from "./SeverityStrip";
import { FieldChip } from "./FieldChip";

export interface MasterRow {
  id: string;
  severity: Severity;
  severityLabel: string;
  code: string;
  text: string;
  field?: { code: string; description?: string };
  countLabel: string;
  /** 0 to 1: this row's share of the largest row. */
  ratio: number;
}

/** A selectable list: severity, rule id and text, field chip, record count and a proportional bar. */
export function MasterList({ rows, selectedId, onSelect, label }: { rows: MasterRow[]; selectedId: string | null; onSelect: (id: string) => void; label: string }) {
  return (
    <ul className="mx-list" aria-label={label}>
      {rows.map((r) => (
        <li key={r.id}>
          <button type="button" className="mx-row" aria-pressed={r.id === selectedId} onClick={() => onSelect(r.id)}>
            <span className="mx-row-top">
              <span className="mx-sev" data-sev={r.severity}><i className="mx-dot" aria-hidden="true" />{r.severityLabel}</span>
              <span className="mx-row-n mx-num">{r.countLabel}</span>
            </span>
            <span className="mx-row-name"><code className="mx-code">{r.code}</code> {r.text}</span>
            {r.field ? <span className="mx-row-field"><FieldChip code={r.field.code} description={r.field.description} /></span> : null}
            <span className="mx-bar" aria-hidden="true"><span data-sev={r.severity} style={{ inlineSize: `${Math.round(Math.max(0, Math.min(1, r.ratio)) * 100)}%` }} /></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

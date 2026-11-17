export interface PairRow { key: "source" | "projected" | "actual"; label: string; value: number | null; note?: string }

/** Source and target data quality: one big number and one bar per row, with an optional reason list. */
export function DqsPair({ rows, naLabel, reasons }: { rows: PairRow[]; naLabel: string; reasons?: { label: string; value: string }[] }) {
  return (
    <div>
      <ul className="mx-pair">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="mx-pair-l">{r.label}</span>
            <span className="mx-pair-v mx-num">{r.value === null ? naLabel : Math.round(r.value * 10) / 10}</span>
            <span className="mx-bar" aria-hidden="true"><span data-k={r.key} style={{ inlineSize: `${r.value ?? 0}%` }} /></span>
            {r.note ? <span className="mx-muted">{r.note}</span> : null}
          </li>
        ))}
      </ul>
      {reasons?.length ? (
        <ul className="mx-reasons">{reasons.map((x) => <li key={x.label}><span>{x.label}</span><span className="mx-num">{x.value}</span></li>)}</ul>
      ) : null}
    </div>
  );
}

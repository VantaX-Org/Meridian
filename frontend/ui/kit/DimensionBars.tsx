export interface DimensionItem { key: string; label: string; value: number | null }

/** One labelled bar per quality dimension, number at the end. With `onSelect` each label is a button. */
export function DimensionBars({ items, naLabel, onSelect, selected }: { items: DimensionItem[]; naLabel: string; onSelect?: (key: string) => void; selected?: string | null }) {
  return (
    <ul className="mx-dims">
      {items.map((x) => (
        <li key={x.key} data-link={onSelect ? "" : undefined} data-selected={selected === x.key ? "true" : undefined} title={`${x.label}: ${x.value === null ? naLabel : Math.round(x.value * 10) / 10}`}>
          <span>{onSelect ? <button type="button" className="mx-hit" aria-pressed={selected === x.key} onClick={() => onSelect(x.key)}>{x.label}</button> : x.label}</span>
          <span className="mx-bar" aria-hidden="true"><span style={{ inlineSize: `${x.value ?? 0}%` }} /></span>
          <span className="mx-num">{x.value === null ? naLabel : Math.round(x.value * 10) / 10}</span>
        </li>
      ))}
    </ul>
  );
}

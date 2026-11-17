export interface DimensionItem { key: string; label: string; value: number | null }

/** One labelled bar per quality dimension, number at the end. */
export function DimensionBars({ items, naLabel }: { items: DimensionItem[]; naLabel: string }) {
  return (
    <ul className="mx-dims">
      {items.map((x) => (
        <li key={x.key}>
          <span>{x.label}</span>
          <span className="mx-bar" aria-hidden="true"><span style={{ inlineSize: `${x.value ?? 0}%` }} /></span>
          <span className="mx-num">{x.value === null ? naLabel : Math.round(x.value * 10) / 10}</span>
        </li>
      ))}
    </ul>
  );
}

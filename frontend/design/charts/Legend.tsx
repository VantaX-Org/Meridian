"use client";

export interface LegendItem {
  key: string;
  name: string;
  /** CSS colour or token reference of the series. */
  color: string;
}

/**
 * Chart legend: 8px square swatches, meta text in ink-2. With `onIsolate` the items are buttons;
 * the isolated series keeps its colour and `isolatedOpacity(key)` dims the rest.
 */
export function ChartLegend({
  items,
  isolated,
  onIsolate,
}: {
  items: LegendItem[];
  isolated?: string | null;
  onIsolate?: (key: string | null) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {items.map((it) => {
        const dim = isolated != null && isolated !== it.key;
        const swatch = <span aria-hidden style={{ width: 8, height: 8, flexShrink: 0, background: it.color }} />;
        return (
          <li key={it.key} style={{ opacity: dim ? 0.25 : 1 }} className="m-motion-fade">
            {onIsolate ? (
              <button
                type="button"
                aria-pressed={isolated === it.key}
                onClick={() => onIsolate(isolated === it.key ? null : it.key)}
                className="inline-flex items-center gap-2 border-0 bg-transparent p-0"
                style={{ fontSize: "var(--m-text-meta)", lineHeight: "var(--m-leading-meta)", color: "var(--m-ink-2)", cursor: "pointer" }}
              >
                {swatch}
                {it.name}
              </button>
            ) : (
              <span className="inline-flex items-center gap-2" style={{ fontSize: "var(--m-text-meta)", lineHeight: "var(--m-leading-meta)", color: "var(--m-ink-2)" }}>
                {swatch}
                {it.name}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Opacity for a series while another is isolated: 1 for the isolated one, 0.25 for the rest. */
export function isolatedOpacity(key: string, isolated: string | null | undefined): number {
  return isolated == null || isolated === key ? 1 : 0.25;
}

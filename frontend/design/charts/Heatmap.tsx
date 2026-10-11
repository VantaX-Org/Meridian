// frontend/design/charts/Heatmap.tsx
import Link from "next/link";

export interface HeatmapCell {
  row: string;
  col: string;
  value: "go" | "at-risk" | "no-go";
}

// Cells are the tone's soft fill with a 6px dot of the full tone centred.

/** Grid heatmap for the readiness cockpit (spec 8.1) — not a recharts chart, a styled table. */
export function Heatmap({
  rows, cols, cells, onPointClick, cellSize = 32, rowHref, draw = false,
}: {
  rows: string[];
  cols: string[];
  cells: HeatmapCell[];
  onPointClick?: (cell: HeatmapCell) => void;
  cellSize?: number;
  rowHref?: (row: string) => string;
  draw?: boolean;
}) {
  const byKey = new Map(cells.map((c) => [`${c.row}:${c.col}`, c]));
  let cellIndex = 0;
  return (
    <table className="text-[12px] leading-4" style={{ borderCollapse: "separate", borderSpacing: 2 }}>
      <thead>
        <tr>
          <th />
          {cols.map((c, ci) => (
            <th key={`${ci}:${c}`} className="px-2 py-1" style={{ color: "var(--m-ink-2)" }}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={`${ri}:${r}`}>
            <td className="px-2 py-1" style={{ color: "var(--m-ink-2)" }}>
              {rowHref ? <Link href={rowHref(r)}>{r}</Link> : r}
            </td>
            {cols.map((c, ci) => {
              const cell = byKey.get(`${r}:${c}`);
              const index = cellIndex++;
              return (
                <td key={`${ci}:${c}`} className="p-0">
                  <button
                    type="button"
                    onClick={() => cell && onPointClick?.(cell)}
                    disabled={!cell}
                    aria-label={cell ? `${r} ${c}: ${cell.value}` : `${r} ${c}: not measured`}
                    className={`m-heat-cell flex items-center justify-center border-0 p-0 ${draw ? "m-motion-rise" : ""}`}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      borderRadius: 3,
                      background: cell ? `var(--m-${cell.value}-soft)` : "var(--m-sheet-sunken)",
                      cursor: cell ? "pointer" : "default",
                      animationDelay: draw ? `calc(var(--m-motion-duration) * ${index / 10})` : undefined,
                    }}
                  >
                    {cell && <span aria-hidden style={{ width: 6, height: 6, borderRadius: "50%", background: `var(--m-${cell.value})` }} />}
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

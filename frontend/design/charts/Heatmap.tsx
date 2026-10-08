// frontend/design/charts/Heatmap.tsx
import { chartTheme } from "./theme";

export interface HeatmapCell {
  row: string;
  col: string;
  value: "go" | "at-risk" | "no-go";
}

const CELL_COLOR: Record<HeatmapCell["value"], string> = {
  go: chartTheme.pass,
  "at-risk": chartTheme.medium,
  "no-go": chartTheme.critical,
};

/** Grid heatmap for the readiness cockpit (spec 8.1) — not a recharts chart, a styled table. */
export function Heatmap({
  rows, cols, cells, onPointClick,
}: {
  rows: string[];
  cols: string[];
  cells: HeatmapCell[];
  onPointClick?: (cell: HeatmapCell) => void;
}) {
  const byKey = new Map(cells.map((c) => [`${c.row}:${c.col}`, c]));
  return (
    <table className="text-[12px] border-collapse">
      <thead>
        <tr>
          <th />
          {cols.map((c) => (
            <th key={c} className="px-2 py-1" style={{ color: "var(--m-ink-2)" }}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r}>
            <td className="px-2 py-1" style={{ color: "var(--m-ink-2)" }}>{r}</td>
            {cols.map((c) => {
              const cell = byKey.get(`${r}:${c}`);
              return (
                <td key={c} className="p-0">
                  <button
                    type="button"
                    onClick={() => cell && onPointClick?.(cell)}
                    disabled={!cell}
                    aria-label={cell ? `${r} ${c}: ${cell.value}` : `${r} ${c}: no data`}
                    className="w-8 h-8 block border-0 p-0"
                    style={{ background: cell ? CELL_COLOR[cell.value] : "var(--m-line)", cursor: cell ? "pointer" : "default" }}
                  />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

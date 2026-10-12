// frontend/design/charts/Heatmap.tsx
import Link from "next/link";
import { divInk, mColor, rampStep, seqInk } from "../tokens";

export type HeatmapTone = "go" | "at-risk" | "no-go";

export interface HeatmapCell {
  row: string;
  col: string;
  /** A tone for readiness cells, or a number for the `seq` and `div` density modes. */
  value: HeatmapTone | number;
}

/**
 * `tone` (default): tone soft fill with a 3px left bar in the tone solid, the bar replaces the old dot.
 * `seq`: numeric cells on the five-step sequential ramp, text from `seqInk`.
 * `div`: numeric cells on the diverging ramp, text from `divInk`.
 */
export type HeatmapMode = "tone" | "seq" | "div";

const toneLook = (t: HeatmapTone) => ({ background: `var(--m-${t}-soft)`, boxShadow: `inset 3px 0 0 var(--m-${t})`, color: `var(--m-${t}-ink)` });

/** Maps a backend tier string (go, at_risk, no_go) onto a heatmap tone. Unknown tiers return undefined. */
export function toneOfTier(tier: string | null | undefined): HeatmapTone | undefined {
  const t = (tier ?? "").replace(/_/g, "-");
  return t === "go" || t === "at-risk" || t === "no-go" ? t : undefined;
}

function cellStyle(value: HeatmapCell["value"], mode: HeatmapMode, range: readonly [number, number], tone?: HeatmapTone) {
  if (typeof value !== "number") return { ...toneLook(value), label: value };
  if (tone) return { ...toneLook(tone), label: `${Math.round(value * 10) / 10}, ${tone.replace("-", " ")}` };
  const step = rampStep(value, range[0], range[1]);
  const label = String(Math.round(value * 10) / 10);
  return mode === "div"
    ? { background: mColor.div[step - 1], boxShadow: undefined, color: divInk(step - 1), label }
    : { background: mColor.seq[step - 1], boxShadow: undefined, color: seqInk(step), label };
}

/** Grid heatmap for the readiness cockpit (spec 8.1) — not a recharts chart, a styled table. */
export function Heatmap({
  rows, cols, cells, onPointClick, cellSize = 32, rowHref, draw = false, mode = "tone", range = mode === "div" ? [-1, 1] : [0, 100], tone,
}: {
  rows: string[];
  cols: string[];
  cells: HeatmapCell[];
  onPointClick?: (cell: HeatmapCell) => void;
  cellSize?: number;
  rowHref?: (row: string) => string;
  draw?: boolean;
  mode?: HeatmapMode;
  /** Value range mapped onto the ramp in `seq` and `div` modes. Defaults to 0 to 100, or -1 to 1 for `div`. */
  range?: readonly [number, number];
  /** Picks a tone for a numeric cell: the cell then shows its number on the tone fill and bar instead of the ramp. */
  tone?: (cell: HeatmapCell) => HeatmapTone | undefined;
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
              const look = cell ? cellStyle(cell.value, mode, range, tone?.(cell)) : null;
              return (
                <td key={`${ci}:${c}`} className="p-0">
                  <button
                    type="button"
                    onClick={() => cell && onPointClick?.(cell)}
                    disabled={!cell}
                    aria-label={cell ? `${r} ${c}: ${look?.label}` : `${r} ${c}: not measured`}
                    className={`m-heat-cell flex items-center justify-center border-0 p-0 ${draw ? "m-motion-rise" : ""}`}
                    style={{
                      width: cellSize,
                      height: cellSize,
                      borderRadius: 3,
                      background: look ? look.background : "var(--m-sheet-sunken)",
                      boxShadow: look?.boxShadow,
                      color: look?.color,
                      fontVariantNumeric: "tabular-nums",
                      fontSize: "var(--m-text-micro)",
                      cursor: cell ? "pointer" : "default",
                      animationDelay: draw ? `calc(var(--m-motion-duration) * ${index / 10})` : undefined,
                    }}
                  >
                    {look && typeof cell?.value === "number" && String(Math.round(cell.value * 10) / 10)}
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

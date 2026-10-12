import type { BarShapeProps } from "recharts";
import { chartTheme } from "./theme";

/**
 * Hover state for a bar: the bar keeps its fill and a 12 percent accent overlay is drawn on top,
 * never a colour swap. Pass as `activeBar` on a recharts `Bar`.
 */
export function hoverBar(props: BarShapeProps) {
  const { x, y, width, height, fill, index } = props;
  return (
    <g key={index}>
      <rect x={x} y={y} width={width} height={height} fill={fill} rx={3} />
      <rect x={x} y={y} width={width} height={height} fill={chartTheme.accentHover} fillOpacity={0.12} rx={3} />
    </g>
  );
}

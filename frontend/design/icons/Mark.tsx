// frontend/design/icons/Mark.tsx
import type { CSSProperties, SVGProps } from "react";

/**
 * The Meridian mark (DESIGN.md §4): a 270 degree gauge arc, open at the top, crossed by the meridian
 * line. Two strokes of one weight, no fill. `two-tone` (default): arc in ink, meridian in the accent.
 * `mono`: both in `currentColor`. Never on a tile (the OS app icon is the one exception).
 */
export function MeridianMark({ size = 32, variant = "two-tone", className, style, ...rest }: Omit<SVGProps<SVGSVGElement>, "ref"> & { size?: number; className?: string; style?: CSSProperties; variant?: "two-tone" | "mono" }) {
  const mono = variant === "mono";
  const stroke = { fill: "none", strokeWidth: 3, strokeLinecap: "round" as const };
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 32 32" className={className} style={style} aria-hidden="true" {...rest}>
      <path d="M21.74 7.81A10 10 0 1 1 10.26 7.81" stroke={mono ? "currentColor" : "var(--m-ink)"} {...stroke} />
      <path d="M16 3V29" stroke={mono ? "currentColor" : "var(--m-accent)"} {...stroke} />
    </svg>
  );
}

import type { SVGProps } from "react";

type IconProps = { size?: number; className?: string; style?: React.CSSProperties } & SVGProps<SVGSVGElement>;

/**
 * The meridian M: a square tile in the accent colour with an M whose centre
 * vertex continues as a plumb line past the baseline — the line is the
 * meridian, the letterform is the product. Reads as "a square with an M"
 * from 16px up. Same geometry as the favicon, the XLSX cover and the PDF
 * cover (frontend/public/brand).
 *
 * `variant="tile"` (default) draws the accent tile behind the mark —
 * `aria-hidden` it when the visible word "Meridian" sits next to it.
 * `variant="mono"` omits the tile and strokes in `currentColor`, for the
 * one large brand moment on the sign-in page.
 */
export function MeridianMark({ size = 32, variant = "tile", className, style, ...rest }: IconProps & { variant?: "tile" | "mono" }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      style={style}
      aria-hidden="true"
      {...rest}
    >
      {variant === "tile" ? <rect width="32" height="32" rx="6" fill="var(--m-accent)" /> : null}
      <path
        d="M 7.5 24 V 8.5 M 24.5 24 V 8.5 M 7.5 8.5 L 16 17 L 24.5 8.5 M 16 17 V 25.5"
        fill="none"
        stroke={variant === "mono" ? "currentColor" : "var(--m-sheet)"}
        strokeWidth={3.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const baseLine = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function TrendUp({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseLine} className={className} style={style} aria-hidden="true">
      <path d="m3 17 6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </svg>
  );
}
export function TrendDown({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseLine} className={className} style={style} aria-hidden="true">
      <path d="m3 7 6 6 4-4 8 8" />
      <path d="M14 17h7v-7" />
    </svg>
  );
}
export function MinusIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseLine} className={className} style={style} aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  );
}
export function ArrowUpRight({ size = 13, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseLine} className={className} style={style} aria-hidden="true">
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}
export function ArrowRight({ size = 13, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseLine} className={className} style={style} aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}
export function MoreH({ size = 14, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </svg>
  );
}
export function FilterIcon({ size = 13, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseLine} className={className} style={style} aria-hidden="true">
      <path d="M3 5h18l-7 8v6l-4 2v-8z" />
    </svg>
  );
}
export function BookmarkIcon({ size = 14, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseLine} className={className} style={style} aria-hidden="true">
      <path d="M6 4h12v17l-6-4-6 4z" />
    </svg>
  );
}
export function MailIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseLine} className={className} style={style} aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

export function LockIcon({ size = 16, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseLine} className={className} style={style} aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function PlayTriangleIcon({ size = 14, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
      <path d="M7 5v14l11-7z" />
    </svg>
  );
}

export function UploadCloudIcon({ size = 28, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseLine} className={className} style={style} aria-hidden="true">
      <path d="M7 11a5 5 0 0 1 9.5-2A4 4 0 0 1 17 17H7a3 3 0 0 1 0-6Z" />
      <path d="M12 14V8" />
      <path d="m9.5 10.5 2.5-2.5 2.5 2.5" />
    </svg>
  );
}

export function FileTextIcon({ size = 14, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...baseLine} className={className} style={style} aria-hidden="true">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h5" />
    </svg>
  );
}

export function SparklesIcon({ size = 15, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} style={style} aria-hidden="true">
      <path d="M12 4.5 13.4 9 18 10.4 13.4 11.8 12 16.3 10.6 11.8 6 10.4 10.6 9z" />
      <path d="M19 16v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M17.5 17.5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M5 5v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M4 6h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

// The JSX that next/og renders into the Open Graph image and the Apple touch icon (app/opengraph-image.tsx,
// app/apple-icon.tsx). Satori reads only inline styles and cannot read CSS tokens, so these live in the design
// library (where inline style is allowed) and mirror public/brand/brand.json: canvas, sheet, ink, ink-2, accent.
// Canvas: a white sheet on the blue-grey canvas, the two-tone mark, type in ink. No cover, no gradient.
const CANVAS = "rgb(244 246 248)";
const SHEET = "rgb(255 255 255)";
const LINE = "rgb(230 234 240)";
const INK = "rgb(26 34 51)";
const INK_2 = "rgb(63 74 92)";
const ACCENT = "rgb(37 99 235)";

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d="M21.74 7.81A10 10 0 1 1 10.26 7.81" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      <path d="M16 3V29" stroke={ACCENT} strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

/** 1200 x 630: one white sheet on the canvas, the lockup, "SAP data quality, measured" and one line under it. Font family "Public Sans". */
export function ogImage() {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", padding: 48, background: CANVAS, fontFamily: "Public Sans" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: SHEET, border: `2px solid ${LINE}`, borderRadius: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Mark size={64} />
          <div style={{ display: "flex", fontSize: 36, fontWeight: 600, color: INK, letterSpacing: "-0.01em" }}>Meridian</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", fontSize: 56, fontWeight: 600, color: INK, letterSpacing: "-0.01em", lineHeight: 1.1 }}>SAP data quality, measured</div>
          <div style={{ display: "flex", fontSize: 26, fontWeight: 400, color: INK_2 }}>Deterministic checks, explained scores, S/4 readiness per object</div>
        </div>
      </div>
    </div>
  );
}

/** 180 x 180: the mark on a plain canvas tile, the one place the mark sits on a tile. */
export function appleIcon() {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: CANVAS }}>
      <Mark size={124} />
    </div>
  );
}

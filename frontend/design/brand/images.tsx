// The JSX that next/og renders into the Open Graph image and the Apple touch icon (app/opengraph-image.tsx,
// app/apple-icon.tsx). Satori reads only inline styles and cannot read CSS tokens, so these live in the design
// library (where inline style is allowed) and mirror hero-ink, hero-ink-2, ember and grad-cover (dark).
const INK = "rgb(237 237 240)";
const INK_2 = "rgb(183 196 255)";
const ACCENT = "rgb(255 122 69)";
const COVER_TOP = "rgb(10 15 46)";
const COVER_BOTTOM = "rgb(22 40 138)";

function Cover({ width, height }: { width: number; height: number }) {
  return (
    <svg width={width} height={height} style={{ position: "absolute", top: 0, left: 0 }}>
      <defs>
        <linearGradient id="cover" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={COVER_TOP} />
          <stop offset="1" stopColor={COVER_BOTTOM} />
        </linearGradient>
      </defs>
      <rect width={width} height={height} fill="url(#cover)" />
    </svg>
  );
}

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d="M21.74 7.81A10 10 0 1 1 10.26 7.81" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      <path d="M16 3V29" stroke={ACCENT} strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

/** 1200 x 630: lockup over the cover, "SAP data quality, measured" and one line under it. Font family "Public Sans". */
export function ogImage() {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, fontFamily: "Public Sans" }}>
      <Cover width={1200} height={630} />
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <Mark size={64} />
        <div style={{ display: "flex", fontSize: 36, fontWeight: 600, color: INK, letterSpacing: "-0.01em" }}>Meridian</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", fontSize: 48, fontWeight: 600, color: INK, letterSpacing: "-0.01em" }}>SAP data quality, measured</div>
        <div style={{ display: "flex", fontSize: 24, fontWeight: 400, color: INK_2 }}>Deterministic checks, explained scores, S/4 readiness per object</div>
      </div>
    </div>
  );
}

/** 180 x 180: the mark centred on the cover. */
export function appleIcon() {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Cover width={180} height={180} />
      <Mark size={128} />
    </div>
  );
}

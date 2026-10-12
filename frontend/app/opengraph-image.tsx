import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import brand from "../public/brand/brand.json";

export const alt = "Meridian: SAP data quality, measured";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand colours come from brand.json; ImageResponse cannot read CSS tokens.
const { ink: INK, ink2: INK_2, accent: ACCENT, canvas: CANVAS } = brand;

const font = (weight: 400 | 600) => readFile(join(process.cwd(), "app/_fonts", `PublicSans-${weight}.ttf`));

export default async function Image() {
  const [regular, semibold] = await Promise.all([font(400), font(600)]);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: CANVAS, fontFamily: "Public Sans" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width={64} height={64} viewBox="0 0 32 32" fill="none">
            <path d="M21.74 7.81A10 10 0 1 1 10.26 7.81" stroke={INK} strokeWidth={3} strokeLinecap="round" />
            <path d="M16 3V29" stroke={ACCENT} strokeWidth={3} strokeLinecap="round" />
          </svg>
          <div style={{ display: "flex", fontSize: 36, fontWeight: 600, color: INK, letterSpacing: "-0.01em" }}>Meridian</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", fontSize: 48, fontWeight: 600, color: INK, letterSpacing: "-0.01em" }}>SAP data quality, measured</div>
          <div style={{ display: "flex", fontSize: 24, fontWeight: 400, color: INK_2 }}>Deterministic checks, explained scores, S/4 readiness per object</div>
        </div>
      </div>
    ),
    { ...size, fonts: [
      { name: "Public Sans", data: regular, weight: 400, style: "normal" },
      { name: "Public Sans", data: semibold, weight: 600, style: "normal" },
    ] },
  );
}

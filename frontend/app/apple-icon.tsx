import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// ImageResponse cannot read CSS tokens; these mirror hero-ink, ember and grad-cover (dark).
const INK = "rgb(237 237 240)";
const ACCENT = "rgb(255 122 69)";
const COVER_TOP = "rgb(10 15 46)";
const COVER_BOTTOM = "rgb(22 40 138)";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width={180} height={180} style={{ position: "absolute", top: 0, left: 0 }}>
        <defs>
          <linearGradient id="cover" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={COVER_TOP} />
            <stop offset="1" stopColor={COVER_BOTTOM} />
          </linearGradient>
        </defs>
        <rect width={180} height={180} fill="url(#cover)" />
      </svg>
              <svg width={128} height={128} viewBox="0 0 32 32" fill="none">
          <path d="M21.74 7.81A10 10 0 1 1 10.26 7.81" stroke={INK} strokeWidth={3} strokeLinecap="round" />
          <path d="M16 3V29" stroke={ACCENT} strokeWidth={3} strokeLinecap="round" />
        </svg>
      </div>
    ),
    size,
  );
}

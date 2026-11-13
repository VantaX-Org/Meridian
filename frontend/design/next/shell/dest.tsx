"use client";

import { t } from "@/lib/v2/i18n";
import { PATHS, type DestId } from "@/lib/next/nav-defaults";

/** One glyph per destination, drawn here because the kit's icon set is closed. */
const GLYPH: Record<DestId, string> = {
  home: "M3 9.5 10 3l7 6.5V17H12v-5H8v5H3Z", // i18n-ignore: SVG path data
  work: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM6.8 10.2l2.2 2.2 4.2-4.6", // i18n-ignore: SVG path data
  load: "M10 3v10M6 9l4 4 4-4M4 16h12", // i18n-ignore: SVG path data
  runs: "M3 14l4-5 3 3 4-6 3 4", // i18n-ignore: SVG path data
  more: "M4 10h.01M10 10h.01M16 10h.01", // i18n-ignore: SVG path data
};

export function Glyph({ id }: { id: DestId }) {
  return (
    <svg className="nx-tab-glyph" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={id === "more" ? 3 : 1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={GLYPH[id]} />
    </svg>
  );
}

export const LABEL: Record<DestId, () => string> = {
  home: () => t("Home"),
  work: () => t("Work"),
  load: () => t("Load"),
  runs: () => t("Runs"),
  more: () => t("More"),
};

/** Which destination owns this address: the longest path prefix wins; the root only matches itself. */
export function destAt(pathname: string): DestId | null {
  let best: DestId | null = null;
  for (const id of Object.keys(PATHS) as DestId[]) {
    const p = PATHS[id];
    const hit = p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`);
    if (hit && (!best || p.length > PATHS[best].length)) best = id;
  }
  return best;
}

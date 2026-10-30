"use client";

import { t, useInterfaceLang } from "@/lib/v2/i18n";

/**
 * The Aletheia attribution: the licensed mark and name, on every screen (Aletheia licence, section 6, "Attribution
 * is mandatory"). Rendered once by the root layout, in the document flow as a strip under the page (never fixed, never
 * over content), so signed-in, signed-out and presentation screens all carry it. The mark is Aletheia's own SVG,
 * unaltered, from public/brand/aletheia-mark.svg. The strip says what it is, in the interface's language: a licensed
 * mark whose attribution the licence requires (help: docs/guide/overview.md, "The strip at the foot of every page").
 */
export function Attribution() {
  const { tag } = useInterfaceLang();
  const why = t("Aletheia is a licensed mark. Its licence requires this attribution on every screen; it is not a second product.");
  return (
    <div className="m-attribution" data-testid="aletheia-attribution" title={why} lang={tag}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a static, licensed mark; next/image adds nothing here */}
      <img src="/brand/aletheia-mark.svg" alt="" width={16} height={16} />
      <span>Aletheia</span>
      <span className="m-attribution-note">{t("licensed mark, attribution required")}</span>
      <span className="m-sr-only">{why}</span>
    </div>
  );
}

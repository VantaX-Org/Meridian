/**
 * The Aletheia attribution: the licensed mark and name, on every screen (Aletheia licence, section 6, "Attribution
 * is mandatory"). Rendered once by the root layout, in the document flow as a strip under the page (never fixed, never over content), so signed-in, signed-out and presentation screens all carry it.
 * The mark is Aletheia's own SVG, unaltered, from public/brand/aletheia-mark.svg.
 */
export function Attribution() {
  return (
    <div className="m-attribution" data-testid="aletheia-attribution" title="Vantax Aletheia">
      {/* eslint-disable-next-line @next/next/no-img-element -- a static, licensed mark; next/image adds nothing here */}
      <img src="/brand/aletheia-mark.svg" alt="" width={16} height={16} />
      <span>Aletheia</span>
    </div>
  );
}

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../motion.css"), "utf8");
const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
const CLASSES = ["nx-m-spring", "nx-m-sheet", "nx-m-pop", "nx-m-title", "nx-m-thumb", "nx-m-row", "nx-m-count", "nx-m-sidebar"];

describe("next motion classes (design-apple-meta.md 2.5)", () => {
  it("declares the spring and collapse tokens", () => {
    for (const t of ["--nx-dur-spring: 420ms", "--nx-ease-spring: cubic-bezier(0.34, 1.26, 0.64, 1)", "--nx-dur-collapse: 240ms", "--nx-ease-out:"]) expect(css, t).toContain(t);
  });
  it.each(CLASSES)("declares .%s with a transition", (c) => {
    expect(css).toMatch(new RegExp(`\\.${c}\\s*\\{[^}]*transition`));
  });
  it("sheet and pop switch on data-state", () => {
    for (const c of ["nx-m-sheet", "nx-m-pop"]) for (const s of ["open", "closed"]) expect(css).toContain(`.${c}[data-state="${s}"]`);
  });
  it("pop reads its origin from --nx-pop-origin", () => {
    expect(css).toContain("transform-origin: var(--nx-pop-origin)");
  });
  it("reduced motion shortens the new durations and names every moving class", () => {
    expect(reduced).toContain("--nx-dur-spring: 1ms");
    expect(reduced).toContain("--nx-dur-collapse: 1ms");
    for (const c of ["nx-m-sheet", "nx-m-pop", "nx-m-spring", "nx-m-thumb", "nx-m-title", "nx-m-sidebar"]) expect(reduced, c).toContain(c);
  });
  it("sheet and pop fall back to opacity only", () => {
    expect(reduced).toMatch(/\.nx-m-sheet, \.nx-m-pop \{ transition: opacity 1ms; \}/);
  });
  it("honours the in-app data-reduce-motion setting too", () => {
    expect(css).toContain(".nx-root[data-reduce-motion]");
  });
});

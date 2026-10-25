// The shell's CSS contracts that jsdom cannot lay out: read from the stylesheets and the (app) layout.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..");
const globals = readFileSync(join(root, "app/globals.css"), "utf8");
const layout = readFileSync(join(root, "app/(app)/layout.tsx"), "utf8");

/** The body of the first `@media (max-width: 1023px)` block holding `selector`. */
function narrowRule(selector: string): string {
  const blocks = globals.split("@media (max-width: 1023px)").slice(1);
  for (const b of blocks) {
    const m = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(b);
    if (m) return m[1];
  }
  return "";
}

describe("shell layout", () => {
  it("wraps the scope bar below lg, so search and the pickers never push the page sideways", () => {
    expect(narrowRule(".m-scopebar")).toMatch(/flex-wrap:\s*wrap/);
    const trailing = narrowRule(".m-scopebar-trailing");
    expect(trailing).toMatch(/flex-wrap:\s*wrap/);
    expect(trailing).toMatch(/white-space:\s*normal/);
    expect(trailing).toMatch(/max-width:\s*100%/);
  });

  it("keeps the More panel out of the scrolling pill strip: fixed to the viewport, not absolute inside it", () => {
    const more = /\.m-topnav-more\s*\{([^}]*)\}/.exec(globals)?.[1] ?? "";
    expect(more).toMatch(/position:\s*fixed/);
    expect(/\.m-topnav-nav\s*\{([^}]*)\}/.exec(globals)?.[1]).toMatch(/overflow-x:\s*auto/);
  });

  it("gives presentation mode the same bottom room as the shell, so Exit presentation never covers the last row", () => {
    const room = "[padding-bottom:calc(var(--m-space-10)+var(--m-space-8))]";
    const mains = layout.match(/<main [^>]*>/g) ?? [];
    expect(mains).toHaveLength(2);
    for (const main of mains) expect(main).toContain(room);
  });
});

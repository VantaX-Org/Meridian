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
    // The pills scroll in their own strip inside the nav; More sits beside it, outside the scroller.
    expect(/\.m-topnav-scroll\s*\{([^}]*)\}/.exec(globals)?.[1]).toMatch(/overflow-x:\s*auto/);
    expect(/\.m-topnav-nav\s*\{([^}]*)\}/.exec(globals)?.[1]).not.toMatch(/overflow-x/);
  });

  it("gives presentation mode the same bottom room as the shell, so Exit presentation never covers the last row", () => {
    const mains = layout.match(/<main [^>]*>/g) ?? [];
    expect(mains).toHaveLength(2);
    for (const main of mains) expect(main).toMatch(/\bm-shell-main\b/);
  });

  it("keeps the launcher's height free at the foot of the main scroller, as padding and as scroll padding, above the safe area", () => {
    const main = /\.m-shell-main\s*\{([^}]*)\}/.exec(globals)?.[1] ?? "";
    expect(main).toMatch(/padding-bottom:\s*calc\(var\(--m-launcher-clearance\)\s*\+\s*env\(safe-area-inset-bottom\)\)/);
    expect(main).toMatch(/scroll-padding-bottom:\s*calc\(var\(--m-launcher-clearance\)\s*\+\s*env\(safe-area-inset-bottom\)\)/);
  });
});

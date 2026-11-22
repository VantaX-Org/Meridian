import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards the phone-width fixes: a tab strip scrolls inside itself, and the
// insights page grid cannot grow wider than the screen.
const css = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("narrow screens", () => {
  it("tab strip scrolls instead of widening the page", () => {
    expect(css("kit/kit.css")).toMatch(/\.mx-tabs \{[^}]*overflow-x: auto/);
  });
  it("insights page column is clamped to the screen", () => {
    expect(css("screens/insights/insights.css")).toMatch(/\.b8-page \{[^}]*minmax\(0, 1fr\)/);
  });
});

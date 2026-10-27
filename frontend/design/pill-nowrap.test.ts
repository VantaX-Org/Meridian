// A status pill is one token: at 390px a verdict in a narrow ledger cell broke into "No-" / "go".
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf8");
const rule = (selector: string) => css.split("\n").find((l) => l.trim().startsWith(`${selector} {`)) ?? "";

describe("pill and tab-strip layout rules", () => {
  it("never wraps or shrinks a pill", () => {
    expect(rule(".m-pill")).toMatch(/white-space:\s*nowrap/);
    expect(rule(".m-pill")).toMatch(/flex-shrink:\s*0/);
  });

  it("draws the tab strip and its More menu on one base line", () => {
    expect(rule(".m-tabs-bar")).toMatch(/box-shadow:\s*inset 0 -1px 0 var\(--m-line\)/);
    expect(rule(".m-tab-more[data-selected]")).toMatch(/var\(--m-accent\)/);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "ui/tokens.css"), "utf8");
const decl = (name: string): string[] => [...css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, "g"))].map((m) => m[1].trim());

describe("enterprise tokens", () => {
  it("sets compact density and the wider page", () => {
    expect(decl("--mx-h-control")[0]).toBe("32px");
    expect(decl("--mx-h-row")[0]).toBe("32px");
    expect(decl("--mx-page-max")[0]).toBe("105rem");
    expect(decl("--mx-fs-body")[0]).toBe("0.8125rem");
  });
  it("keeps categorical chart series off status colours", () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const v = decl(`--mx-chart-${n}`);
      expect(v.length).toBe(3);
      for (const x of v) expect(x).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
  it("keeps both dark blocks identical for chart values", () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const [, a, b] = decl(`--mx-chart-${n}`);
      expect(a).toBe(b);
    }
  });
});

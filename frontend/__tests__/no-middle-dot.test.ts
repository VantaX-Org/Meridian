import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Never a middle dot (U+00B7) anywhere under frontend/: not as the character, not as a CSS escape (`\00B7`, `\B7`),
 * not as an HTML entity (`&middot;`, `&#183;`, `&#xB7;`) and not as a JavaScript escape. A separator is drawn by CSS
 * (`.m2-dot`). The Japanese catalogue may use the character inside Japanese text (katakana word breaks), and its test
 * reads it back.
 */
const ROOT = join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".next", "coverage", "playwright-report", "test-results", "help-videos-raw", ".git"]);
const TEXT = /\.(ts|tsx|js|mjs|cjs|css|json|md|html|txt|yml|yaml|py|vtt)$/;
const ALLOWED = new Set(["lib/v2/i18n/ja.ts", "lib/v2/i18n/__tests__/t.test.ts", "__tests__/no-middle-dot.test.ts", "eslint-rules/meridian-writing.mjs"]);
const DOT = String.fromCharCode(0xb7);
const PATTERNS: [string, RegExp][] = [
  ["the character", new RegExp(DOT)],
  ["a CSS escape", /\\0{0,4}b7(?![0-9a-f])/i],
  ["an HTML entity", /&middot;|&#183;|&#x0*b7;/i],
  ["a JavaScript escape", /\\u00b7|\\u\{b7\}|\\xb7/i],
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return SKIP_DIRS.has(name) ? [] : files(p);
    return TEXT.test(name) ? [p] : [];
  });
}

describe("no middle dot", () => {
  it("no source file under frontend/ holds U+00B7 in any spelling", () => {
    const found: string[] = [];
    for (const f of files(ROOT)) {
      const rel = relative(ROOT, f);
      if (ALLOWED.has(rel)) continue;
      const src = readFileSync(f, "utf8");
      for (const [what, re] of PATTERNS) if (re.test(src)) found.push(`${rel}: ${what}`);
    }
    expect(found).toEqual([]);
  });

  it("catches each spelling", () => {
    expect(PATTERNS.find(([, re]) => re.test('.x::before { content: "\\00B7"; }'))?.[0]).toBe("a CSS escape");
    expect(PATTERNS.find(([, re]) => re.test("a &middot; b"))?.[0]).toBe("an HTML entity");
    expect(PATTERNS.find(([, re]) => re.test(`a ${DOT} b`))?.[0]).toBe("the character");
  });
});

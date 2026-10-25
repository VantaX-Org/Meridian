// frontend/design/tokens-defined.test.ts
// Every `var(--m-*)` the source reads must be a token `design/tokens.css` defines, or a local custom property the
// source itself sets (a CSS declaration such as `--m-level: 2;`, or an inline `"--m-draw-length"` style key). An
// undefined token resolves to nothing, so a background or border silently disappears.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const DIRS = ["app", "components", "design", "lib", "hooks"];
const EXT = /\.(tsx?|css)$/;

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXT.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("design tokens", () => {
  it("every var(--m-*) the source reads is defined", () => {
    const files = DIRS.flatMap((d) => walk(path.join(ROOT, d), []));
    const defined = new Set<string>();
    const uses: { file: string; name: string }[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/(--m-[a-z0-9-]*[a-z0-9])\s*:/g)) defined.add(m[1]);
      for (const m of src.matchAll(/["'`](--m-[a-z0-9-]*[a-z0-9])["'`]/g)) defined.add(m[1]);
      // A name built from a template (`var(--m-dom-${d})`) ends in "-" and is checked where its parts are; a read with
      // a fallback (`var(--m-bar-i, 0)`) is an optional hook, not a token.
      for (const m of src.matchAll(/var\((--m-[a-z0-9-]+)\s*([,)]?)/g)) {
        if (!m[1].endsWith("-") && m[2] !== ",") uses.push({ file: path.relative(ROOT, file), name: m[1] });
      }
    }
    const missing = uses.filter((u) => !defined.has(u.name)).map((u) => `${u.file}: ${u.name}`);
    expect([...new Set(missing)]).toEqual([]);
  });
});

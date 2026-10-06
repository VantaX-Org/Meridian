/**
 * Tests for one-h1, tally-figure-numeric, no-raw-id, format-date-only and the
 * "&" glyph check. Run: node eslint-rules/aurora-truth.test.mjs
 */
import assert from "node:assert/strict";
import { Linter } from "eslint";
import writing from "./aurora-writing.mjs";
import structure from "./aurora-structure.mjs";

const linter = new Linter({ cwd: "/" });
const cfg = (rule, plugin, name) => [{
  files: ["**/*.{ts,tsx}"],
  plugins: { [name]: plugin },
  languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
  rules: { [`${name}/${rule}`]: "error" },
}];
const count = (rule, code, file = "/app/components/x.tsx") => {
  const [plugin, name] = rule in writing.rules ? [writing, "aurora-writing"] : [structure, "aurora-structure"];
  return linter.verify(code, cfg(rule, plugin, name), file).filter((m) => m.ruleId).length;
};

// one-h1
assert.equal(count("one-h1", "const a = <h1>x</h1>;"), 1);
assert.equal(count("one-h1", 'const a = <Text as="h1">x</Text>;'), 1);
assert.equal(count("one-h1", 'const a = <Text variant="display-lg">x</Text>;'), 1);
assert.equal(count("one-h1", 'const a = <Text variant="display-sm" as="p">x</Text>;'), 0);
assert.equal(count("one-h1", "const a = <h1>x</h1>;", "/app/components/ui-core/index.tsx"), 0);

// tally-figure-numeric
assert.equal(count("tally-figure-numeric", 'const a = <TallyFigure label="a" value="None" />;'), 1);
assert.equal(count("tally-figure-numeric", 'const a = <TallyFigure label="a" value={n || "None"} />;'), 1);
assert.equal(count("tally-figure-numeric", 'const a = <TallyFigure label="a" value={ok ? 1 : "Never"} />;'), 1);
assert.equal(count("tally-figure-numeric", 'const a = <TallyFigure label="a" value={null} text="Active" />;'), 0);
assert.equal(count("tally-figure-numeric", 'const a = { label: "a", value: "None", href: "/x" };'), 1);
assert.equal(count("tally-figure-numeric", 'const a = { label: "a", value: n ?? null, href: "/x" };'), 0);

// no-raw-id
assert.equal(count("no-raw-id", "const a = <td>{c.module}</td>;"), 1);
assert.equal(count("no-raw-id", "const a = <td>{c.status}</td>;"), 1);
assert.equal(count("no-raw-id", "const a = <td>{t.id.slice(0, 8)}</td>;"), 1);
assert.equal(count("no-raw-id", "const a = <td>{labelOf(c.status)}</td>;"), 0);
assert.equal(count("no-raw-id", "const a = <Mono>{c.module}</Mono>;"), 0);
assert.equal(count("no-raw-id", "const a = <td><Mono>{t.id.slice(0, 8)}</Mono></td>;"), 0);

// format-date-only
assert.equal(count("format-date-only", "d.toLocaleDateString();"), 1);
assert.equal(count("format-date-only", "d.toLocaleTimeString();"), 1);
assert.equal(count("format-date-only", "new Date(x).toLocaleString();"), 1);
assert.equal(count("format-date-only", "row.created_at.toLocaleString();"), 1);
assert.equal(count("format-date-only", 'x.toLocaleString("en", { month: "short" });'), 1);
assert.equal(count("format-date-only", "n.toLocaleString();"), 0);
assert.equal(count("format-date-only", "r.updated.toLocaleString();"), 0);
assert.equal(count("format-date-only", "d.toLocaleDateString();", "/lib/format.ts"), 0);

// "&" in labels
assert.equal(count("no-forbidden-glyphs", 'const label = "Users & audit";', "/lib/nav.ts"), 1);
assert.equal(count("no-forbidden-glyphs", 'const label = "Users and audit";', "/lib/nav.ts"), 0);
assert.equal(count("no-forbidden-glyphs", 'const q = "?a=1&b=2";', "/lib/nav.ts"), 0);
assert.equal(count("no-forbidden-glyphs", 'const q = "a & b";', "/app/x.ts"), 0, "outside lib and components only JSX is judged");
assert.equal(count("no-forbidden-glyphs", "const a = <p>a & b</p>;", "/app/x.tsx"), 1);

console.log("aurora-truth tests: all passed");

// One word per concept. This test fails when a page reintroduces a second name for a number, a verdict, a
// movement or a run (DESIGN.md "Status vocabulary"; glossary "run", "verdict", "blocking_finding").
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["app", "components"].map((d) => join(__dirname, "..", "..", d));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !p.includes("__tests__")) out.push(p);
  }
  return out;
}

/**
 * Config Intelligence and the custom-object registry group by SAP's functional module (FI, MM ...), which is a
 * different thing from the object a rule checks; there "Module" is the right header.
 */
const SAP_MODULE_TABLES = [
  "app/(app)/systems/[systemId]/config-tab.tsx",
  "app/(app)/systems/[systemId]/custom-objects-tab.tsx",
  "app/(app)/systems/[systemId]/z-object-panels.tsx",
];

/** Each entry: the banned source text, the one word to use instead, and any file where the text means something else. */
const BANNED: [RegExp, string, string[]?][] = [
  [/header: "DQS"/, 'the Score column: header "Score" (DQS is the Stat label with help="dqs")'],
  [/header: "Composite(?: score)?"/, 'header "Score"'],
  [/header: "Delta"/, 'header "Change"'],
  [/label="Delta"/, 'label "Change"'],
  [/header: "Lineage"/, 'header "History"'],
  [/(?:in|of) this lineage/, '"of this system"'],
  [/"Ready to load"/, 'the verdict "Go" through Status'],
  [/"Not ready"/, 'the verdict "No-go" through Status'],
  // "Not ready" is wave readiness (readiness, executive summary); objects under the warning band are below target.
  [/label(=|: )"Objects not ready"|"Open objects not ready"/, '"Objects below target"'],
  [/\b(?:Red|Amber|Green)\b"/, "a Status verdict (go, at-risk, no-go)"],
  [/"Needs attention"/, "a Status verdict (connection health keeps Healthy; a score verdict is Go, At risk, No-go)"],
  [/Showing \$\{|"Showing the first/, "table meta without a Showing sentence"],
  [/Proof of progress/, '"Progress report"'],
  // One name for the scope of Home and the Insights overview and summary: "Current state" (CURRENT_STATE_LABEL).
  [/All runs, current state|Back to all runs|label: "Current state"/, '"Current state" (CURRENT_STATE_LABEL from lib/current-state) for the scope of Home and Insights; one run is named by runScopeLabel'],
  [/v\.label \?\? formatDate\(|label \|\| formatDate\(v\.run_at|\.label \?\? formatDate\(/, "runName() or runScopeLabel() from lib/run-scope"],
  // The steward's page is "Fix work" in the menu, the title and every sentence that sends someone there.
  [/"Fix queue"|[Ff]ix queue|[Ff]ix list/, '"Fix work"'],
  // A rule fails; a check is the engine's word. Counts of failing rules say "Failing rules".
  [/"Failing checks"/, '"Failing rules"'],
  [/"Quality score"|"Composite score/, '"Score"'],
  // The 29 modules are objects on every page (formatModuleName); "Module" only where SAP's functional module is meant.
  [/header: "Module"/, 'header "Object"', SAP_MODULE_TABLES],
  // Activity and feature counts take the verdict words of the page's stats.
  [/header: "(?:Blocked|Degraded)"/, 'header "No-go" or "At risk" (the verdict words)'],
  // "Cleaning proposals" is a tab on Fix work; a count of records to fix is not named after it.
  [/label="Cleaning proposals"/, '"Records to fix" (the Fix work tab), or "Fix work"'],
];

describe("copy vocabulary", () => {
  const files = ROOTS.flatMap((r) => walk(r));
  it("scans the pages and components", () => expect(files.length).toBeGreaterThan(100));
  it.each(BANNED)("never writes %s", (pattern, instead, except = []) => {
    const hits = files.filter((f) => pattern.test(readFileSync(f, "utf8"))).map((h) => h.replace(/.*\/frontend\//, ""));
    expect(hits.filter((h) => !except.includes(h)), `use ${instead}`).toEqual([]);
  });
});

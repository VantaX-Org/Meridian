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

/** Each entry: the banned source text and the one word to use instead. */
const BANNED: [RegExp, string][] = [
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
];

describe("copy vocabulary", () => {
  const files = ROOTS.flatMap((r) => walk(r));
  it("scans the pages and components", () => expect(files.length).toBeGreaterThan(100));
  it.each(BANNED)("never writes %s", (pattern, instead) => {
    const hits = files.filter((f) => pattern.test(readFileSync(f, "utf8")));
    expect(hits.map((h) => h.replace(/.*\/frontend\//, "")), `use ${instead}`).toEqual([]);
  });
});

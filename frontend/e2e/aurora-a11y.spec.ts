/**
 * Aurora accessibility — axe-core on every workspace route, signed in with
 * the recorded API. Critical and serious violations fail; moderate and minor
 * are logged for the polish sweep.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, ROUTES, test } from "./fixtures";

for (const r of ROUTES) {
  test(`a11y — ${r.name} has no critical or serious axe violations`, async ({ app }) => {
    await app.goto(r.path, { waitUntil: "load" });
    await expect(app.getByRole("heading", { level: 1, name: r.heading })).toBeVisible();

    const result = await new AxeBuilder({ page: app })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    const blockers = result.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    const summary = blockers
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`)
      .join("\n");
    const moderate = result.violations.filter((v) => v.impact === "moderate").length;
    const minor = result.violations.filter((v) => v.impact === "minor").length;
    console.log(`[a11y] ${r.name}: ${moderate} moderate, ${minor} minor (non-blocking)`);
    expect(blockers, summary).toEqual([]);
  });
}

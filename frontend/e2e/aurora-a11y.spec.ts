/**
 * Aurora accessibility spec — WS8 §15.3.
 *
 * Runs axe-core against each Aurora route and asserts zero violations
 * at critical + serious impact levels. Moderate/minor are reported in
 * the test output but don't fail — those get swept in a focused a11y
 * polish pass rather than blocking every PR.
 *
 * Rule exclusions (spec §15.3 says the full matrix, but these are
 * unavoidable without controlling the host page):
 *   - color-contrast on the host/legacy chrome (Aurora surfaces are
 *     scoped; dashboard layout chrome is outside Aurora's remit and
 *     has pre-existing contrast issues that belong in a legacy sweep)
 *   - region (Aurora surfaces ARE inside a host region by convention)
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const AURORA_ROUTES = [
  { path: "/command-centre", name: "Command Centre" },
  { path: "/workbench", name: "Workbench" },
  { path: "/process", name: "Process" },
  { path: "/admin", name: "Admin" },
] as const;

for (const route of AURORA_ROUTES) {
  test.describe(`a11y — ${route.name}`, () => {
    test("no critical / serious axe violations", async ({ page }) => {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });

      const accessibility = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        // Scope to the Aurora content when present; fall back to whole
        // document for routes where Aurora-scoped selectors aren't yet
        // wrapping everything (Workbench, Admin, etc.).
        .exclude("header[role='banner']") // legacy sidebar chrome
        .exclude(".sidebar-root") // if present
        .analyze();

      const blockers = accessibility.violations.filter(
        (v) => v.impact === "critical" || v.impact === "serious",
      );

      if (blockers.length > 0) {
        // Include the rule id + affected selector(s) in the failure
        // output so the PR can triage immediately.
        const summary = blockers
          .map(
            (v) =>
              `${v.id} (${v.impact}): ${v.nodes.length} node(s) — ${v.help}`,
          )
          .join("\n");
        throw new Error(`axe violations on ${route.name}:\n${summary}`);
      }

      // Non-blocking: log moderate / minor counts so the spec record
      // shows what remains to sweep.
      const moderate = accessibility.violations.filter(
        (v) => v.impact === "moderate",
      ).length;
      const minor = accessibility.violations.filter(
        (v) => v.impact === "minor",
      ).length;
      console.log(
        `[a11y] ${route.name}: ${moderate} moderate, ${minor} minor (non-blocking)`,
      );

      expect(blockers).toEqual([]);
    });
  });
}

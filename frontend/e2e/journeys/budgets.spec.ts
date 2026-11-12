/**
 * Walks every journey of docs/journeys/steps.json that has a `target_clicks` in fixture mode, counts a click for each
 * control it takes, and fails when the count is over the budget: the target of its row in docs/journeys/README.md plus
 * 20 percent, rounded up. At each step the control counted must be on the page, unless the step `needs` a state the
 * fixture cannot reach. lib/v2/journey-budget.test.ts checks the same arithmetic without a browser.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3055 npx playwright test e2e/journeys/budgets.spec.ts
 */

import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { budgetMessage, budgetOf, type Journey } from "../../lib/v2/journey-budget";

const JOURNEYS: Journey[] = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", "docs", "journeys", "steps.json"), "utf8"));
// ids that exist in the fixture data the demo build serves (as in e2e/v2-journeys.spec.ts)
const IDS: Record<string, string> = {
  system: "ecc-production",
  object: "material-master",
  system_id: "a1b2c3d4-0001-4000-8000-000000000001",
  batch_id: "B-241",
  rule_id: "MM142",
};
const fill = (route: string) => route.replace(/\{([a-z0-9_]+)\}/g, (_, k: string) => IDS[k] ?? k);
const withFixture = (route: string, role: string) => `${route}${route.includes("?") ? "&" : "?"}fixture=1&role=${role}`;
const pattern = (text: string) => new RegExp(text.split(/\{[a-z0-9_]+\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".+?"), "i");

async function prepare(page: Page) {
  await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
  await page.route("**/api/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
}

test.describe.configure({ mode: "parallel" });

for (const j of JOURNEYS.filter((x) => x.target_clicks !== undefined)) {
  const target = j.target_clicks as number;
  test(`journey ${j.id} (${j.role}) stays within ${budgetOf(target)} clicks`, async ({ page }) => {
    test.setTimeout(240_000);
    await prepare(page);
    let clicks = 0;
    for (const s of j.steps) {
      if (s.control === null) continue;
      const url = withFixture(fill(s.route), j.role);
      await test.step(`${url}: ${s.control}`, async () => {
        clicks += 1;
        if (s.needs) return;
        await page.goto(url, { timeout: 90_000 });
        const control = page.locator("a, button, [role=tab], [role=menuitem], summary").filter({ hasText: pattern(s.control as string) });
        await expect(control.first(), `${url} offers "${s.control}"`).toBeAttached({ timeout: 30_000 });
      });
    }
    expect(clicks, budgetMessage(j.id, clicks, target)).toBeLessThanOrEqual(budgetOf(target));
  });
}

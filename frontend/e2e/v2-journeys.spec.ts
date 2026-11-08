/**
 * Walks every journey in docs/journeys/steps.json in fixture mode (`?fixture=1`), so the spec needs no API. At each
 * step the page must draw (no 404, no error frame), show the text the journey expects, and offer the control the
 * journey takes next. A step that fails is a dead end a user would hit.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3055 npx playwright test e2e/v2-journeys.spec.ts
 */

import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// `needs` names the action or data a step depends on; the fixture cannot reach that state, so only the route is checked
type Step = { route: string; control: string | null; expect: string | null; needs?: string };
type Journey = { id: string; role: string; object: string | null; steps: Step[] };

const JOURNEYS: Journey[] = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "docs", "journeys", "steps.json"), "utf8"));
// ids that exist in the fixture data the demo build serves
const IDS: Record<string, string> = {
  system: "ecc-production",
  object: "material-master",
  system_id: "a1b2c3d4-0001-4000-8000-000000000001",
  run_id: "d3229ded-0708-4967-9dfb-1b7f4fada953",
  a: "b0500000-0000-4000-8000-000000000005",
  b: "d3229ded-0708-4967-9dfb-1b7f4fada953",
  rule_id: "MM142",
  batch_id: "B-241",
  request_id: "CR-1001",
};
const fill = (route: string) => route.replace(/\{([a-z0-9_]+)\}/g, (_, k: string) => IDS[k] ?? k);
const withFixture = (route: string, role: string) => `${route}${route.includes("?") ? "&" : "?"}fixture=1&role=${role}`;
// copy text in steps.json names live values as {placeholders}; any text stands in for them
const pattern = (text: string) => new RegExp(text.split(/\{[a-z0-9_]+\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".+?"), "i");

async function prepare(page: Page) {
  await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
  await page.route("**/api/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
}

test.describe.configure({ mode: "parallel" });

for (const j of JOURNEYS) {
  test(`journey ${j.id} (${j.role}) has no dead end`, async ({ page }) => {
    test.setTimeout(240_000);
    await prepare(page);
    for (const s of j.steps) {
      const url = withFixture(fill(s.route), j.role);
      await test.step(`${url} offers ${s.control ?? "(end)"}`, async () => {
        const res = await page.goto(url, { timeout: 90_000 });
        expect(res?.status(), `${url} answered`).toBeLessThan(400);
        await expect(page.getByText("This page could not be found")).toHaveCount(0);
        if (s.needs) return;
        if (s.expect) await expect(page.getByText(pattern(s.expect)).first(), `${url} shows "${s.expect}"`).toBeAttached({ timeout: 30_000 });
        if (s.control) {
          const control = page.locator("a, button, [role=tab], [role=menuitem], summary").filter({ hasText: pattern(s.control) });
          await expect(control.first(), `${url} offers "${s.control}"`).toBeAttached({ timeout: 30_000 });
        }
      });
    }
  });
}

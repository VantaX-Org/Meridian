/**
 * Fresh-install empty states for the wave-9 routes. Run against a fresh
 * database; each route must show its spec sentence, not a blank page.
 */

import { expect, test } from "@playwright/test";

const ROUTES: ReadonlyArray<readonly [string, RegExp]> = [
  ["/systems", /No systems yet\. Connect your first SAP system/],
  ["/objects", /No objects measured yet\./],
  ["/runs", /No runs yet\. Run the first extraction from Systems\./],
  ["/rules", /No rules loaded\./],
  ["/search", /Search objects, records, checks and rules\./],
  ["/import", /No imports yet\./],
  ["/migration", /No migration waves yet\. Create one to track readiness\./],
];

for (const [path, sentence] of ROUTES) {
  test(`${path} shows its fresh-install sentence`, async ({ page }) => {
    await page.goto(path, { waitUntil: "load" });
    await expect(page.getByText(sentence).first()).toBeVisible();
  });
}

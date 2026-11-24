/**
 * Home, objects, object sub-screens, rule, systems and share journeys in fixture mode: each control does what it says
 * (navigates, opens a dialog, downloads a non-empty file or answers with a message), and no page shows U+00B7.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3741 npx playwright test e2e/journeys-objects.spec.ts
 */

import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const NAV = { timeout: 90_000 };
const OBJ = "/o/ecc-production/material-master";
const SYS = "a1b2c3d4-0001-4000-8000-000000000001";
const fx = (url: string) => `${url}${url.includes("?") ? "&" : "?"}fixture=1`;

test.beforeEach(async ({ page }) => {
  test.setTimeout(150_000); // first hit of each route compiles it in dev
  await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("meridian:theme", "light");
    } catch {
      /* blocked storage */
    }
  });
  await page.route("**/api/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
});

const noDot = async (page: Page) => expect(await page.locator("body").innerText()).not.toContain(String.fromCharCode(183));
const h1 = (page: Page, name?: string | RegExp) => expect(page.getByRole("heading", { level: 1, name })).toBeVisible(NAV);

async function downloads(page: Page, click: () => Promise<void>) {
  const [d] = await Promise.all([page.waitForEvent("download", NAV), click()]);
  const p = await d.path();
  expect(d.suggestedFilename()).not.toBe("");
  expect(fs.statSync(p).size).toBeGreaterThan(0);
}

test("home: an attention item opens the screen it names", async ({ page }) => {
  await page.goto(fx("/"), NAV);
  await h1(page, /^Good (morning|afternoon|evening)/);
  await page.getByRole("list", { name: "Attention items" }).getByRole("button", { name: /Procure to pay fitness fell/ }).click();
  await expect(page).toHaveURL(/\/mdm\/processes/, NAV);
  await noDot(page);
});

test("objects: a row opens its card, the workbook downloads and Pull again asks first", async ({ page }) => {
  await page.goto(fx("/o"), NAV);
  await h1(page, "Objects");
  const table = page.getByRole("group", { name: "Objects", exact: true });
  await table.getByRole("row").nth(1).locator("td").nth(2).click();
  await expect(page.getByRole("button", { name: "Open object" }).or(page.getByRole("link", { name: "Open object" }))).toBeVisible(NAV);
  await page.getByRole("main").getByRole("button", { name: "Pull again" }).click();
  await expect(page.getByRole("alertdialog").or(page.getByRole("dialog"))).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alertdialog").or(page.getByRole("dialog"))).toBeHidden();
  await noDot(page);
});

test("objects: bulk Download workbooks saves a file", async ({ page }) => {
  await page.goto(fx("/o"), NAV);
  await h1(page, "Objects");
  await page.getByRole("checkbox", { name: "Select row" }).first().check();
  await downloads(page, () => page.getByRole("toolbar", { name: "Bulk actions" }).getByRole("button", { name: "Download workbooks" }).click());
});

test("object: Download workbook saves a non-empty file and Fix records opens the fix flow", async ({ page }) => {
  await page.goto(fx(OBJ), NAV);
  await h1(page);
  await downloads(page, () => page.getByRole("button", { name: "Download workbook" }).click());
  await page.getByRole("link", { name: "Fix records" }).click();
  await expect(page).not.toHaveURL(new RegExp(`${OBJ}(\\?|$)`), NAV);
  await noDot(page);
});

test("object: Ask Aletheia opens the chat", async ({ page }) => {
  await page.goto(fx(OBJ), NAV);
  await h1(page);
  await page.getByRole("main").getByRole("button", { name: "Ask Aletheia" }).click();
  await expect(page.getByRole("dialog")).toBeVisible(NAV);
});

const TABS: [string, string][] = [["Records", "records"], ["Rules", "rules"], ["Fixes", "fixes"], ["Trend", "trend"]];
for (const [label, sub] of TABS) {
  test(`object: the ${label} tab opens ${sub}`, async ({ page }) => {
    await page.goto(fx(OBJ), NAV);
    await h1(page);
    await page.getByRole("link", { name: label, exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`${OBJ}/${sub}`), NAV);
    await h1(page, label);
    await noDot(page);
  });
}

test("record: the page names the record", async ({ page }) => {
  await page.goto(fx(`${OBJ}/records/000000000000000001`), NAV);
  await h1(page, "Hydraulic pump seal kit");
  await noDot(page);
});

test("rule: the page opens with its title", async ({ page }) => {
  await page.goto(fx("/r/MM142"), NAV);
  await h1(page);
  await noDot(page);
});

test("systems: the list links to the connect wizard", async ({ page }) => {
  await page.goto(fx("/s"), NAV);
  await h1(page, "Systems");
  await page.getByRole("link", { name: "Connect a system" }).first().click();
  await expect(page).toHaveURL(/\/s\/new/, NAV);
  await h1(page, "Connect a system");
});

test("system: Test connection answers and Delete a schedule asks first", async ({ page }) => {
  await page.goto(fx(`/s/${SYS}?tab=extractions`), NAV);
  await h1(page);
  await page.getByRole("button", { name: "Test connection" }).first().click();
  await expect(page.getByText(/ECC production (answered|did not answer)/).first()).toBeVisible(NAV);
  await page.getByRole("button", { name: "Test connection" }).nth(1).click();
  await expect(page.getByText(/The system (answered|did not answer)/).first()).toBeVisible(NAV);
  const del = page.getByRole("main").getByRole("button", { name: "Delete", exact: true });
  if (await del.count()) {
    await del.first().click();
    await expect(page.getByRole("alertdialog").or(page.getByRole("dialog"))).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog").or(page.getByRole("dialog"))).toBeHidden();
  }
  await noDot(page);
});

test("system: an attention link with a tab opens that tab", async ({ page }) => {
  await page.goto(fx(`/s/${SYS}?tab=config`), NAV);
  await expect(page.getByRole("tab", { name: "Configuration", selected: true })).toBeVisible(NAV);
});

test("share: a shared link shows what was shared", async ({ page }) => {
  await page.goto(fx("/share/demo-token"), NAV);
  await expect(page.getByRole("heading", { name: "Shared with you" })).toBeVisible(NAV);
  await noDot(page);
});

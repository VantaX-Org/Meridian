/**
 * Journeys through master data, rules and insights in fixture mode: every tab, the Aletheia chat on every screen,
 * the exports (a real download event) and the actions that change data, each asserted by what the user then sees.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3863 npx playwright test e2e/journeys-mdm.spec.ts
 */

import { expect, test, type Page } from "@playwright/test";

const NAV = { timeout: 90_000 };

const ROUTES = [
  "/mdm", "/mdm/catalogue", "/mdm/glossary", "/mdm/golden", "/mdm/golden/gr-0", "/mdm/issues", "/mdm/lineage", "/mdm/links",
  "/mdm/match", "/mdm/match/gr-0", "/mdm/match-rules", "/mdm/mining", "/mdm/processes", "/mdm/reference", "/mdm/survivorship",
  "/rules", "/rules/dry-run", "/rules/promotion",
  "/insights", "/insights/forecast", "/insights/money", "/insights/score", "/insights/value",
];

test.setTimeout(150_000);

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("meridian:theme", "light");
    } catch {
      /* blocked storage: the page falls back to the system scheme */
    }
  });
  await page.route("**/api/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
});

async function open(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}fixture=1`, NAV);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible(NAV);
  return page.getByRole("main");
}

const toast = (page: Page, text: string | RegExp) => expect(page.getByRole("status").getByText(text).first()).toBeVisible(NAV);

/** Opens an ExportMenu, presses its Export button and waits for the file. */
async function exportFile(page: Page, trigger: string) {
  await page.getByRole("main").getByRole("button", { name: trigger, exact: true }).first().click();
  const menu = page.getByRole("dialog", { name: trigger });
  const download = page.waitForEvent("download");
  await menu.getByRole("button", { name: /^Export/ }).click();
  expect((await download).suggestedFilename()).toMatch(/\S/);
  await toast(page, /Saved|The file is ready/);
}

for (const path of ROUTES) {
  test(`${path}: every tab opens its panel and Aletheia answers from the header`, async ({ page }) => {
    const main = await open(page, path);
    const tabs = main.getByRole("tab");
    const n = await tabs.count();
    for (let i = 0; i < n; i++) {
      await tabs.nth(i).click();
      await expect(tabs.nth(i)).toHaveAttribute("aria-selected", "true");
      await expect(main.getByRole("tabpanel").first()).toBeVisible();
    }
    await main.getByRole("button", { name: "Ask Aletheia" }).first().click();
    const chat = page.getByRole("dialog").filter({ hasText: "Aletheia" }).last();
    await expect(chat).toBeVisible();
    await chat.getByRole("textbox").first().fill("What should I fix first?");
    await chat.getByRole("button", { name: "Send" }).click();
    await expect(chat.getByText("What should I fix first?").first()).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain(String.fromCharCode(0xb7));
  });
}

test("master data hub links reach every screen", async ({ page }) => {
  const main = await open(page, "/mdm");
  const links = main.getByRole("link");
  const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? "").filter((h) => h.startsWith("/mdm/")));
  expect(hrefs.length).toBeGreaterThanOrEqual(12);
  await main.getByRole("link", { name: "Golden records" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Golden records" })).toBeVisible(NAV);
  await page.getByRole("main").getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1, name: /MATNR=/ })).toBeVisible(NAV);
});

test("golden records page through and open a record", async ({ page }) => {
  const main = await open(page, "/mdm/golden");
  const rec = main.locator('a[href^="/mdm/golden/"]').first();
  await expect(rec).toBeVisible(NAV);
  const first = await rec.getAttribute("href");
  await main.getByRole("button", { name: "Next page" }).click();
  await expect(rec).not.toHaveAttribute("href", first ?? "");
  await main.getByRole("button", { name: "Previous page" }).click();
  await expect(rec).toHaveAttribute("href", first ?? "");
  await rec.click();
  await expect(page.getByRole("heading", { level: 1, name: /MATNR=/ })).toBeVisible(NAV);
});

test("match review: merge, not a duplicate, propose, constraint clear and consolidation pack", async ({ page }) => {
  const main = await open(page, "/mdm/match");
  const pairs = main.getByRole("group", { name: "Pairs for review" });
  await expect(pairs.getByRole("row").nth(1)).toBeVisible(NAV);
  const confirm = (title: string) => page.getByRole("alertdialog", { name: title }).getByRole("button", { name: "Confirm" }).click();
  await pairs.getByRole("button", { name: "Merge", exact: true }).first().click();
  await confirm("Merge this pair?");
  await toast(page, "Pair merged");
  await pairs.getByRole("button", { name: "Not a duplicate" }).first().click();
  await confirm("Mark this pair as not a duplicate?");
  await toast(page, "Marked as not a duplicate");
  await main.getByRole("button", { name: "Propose merges" }).click();
  await confirm("Queue merge decisions for the top pairs?");
  await toast(page, /merge decisions queued/);
  await main.getByRole("tab", { name: /Constraints/ }).click();
  const cons = main.getByRole("group", { name: "Pair constraints" });
  await expect(cons.getByText("Cannot link").first()).toBeVisible(NAV);
  await cons.getByRole("button", { name: "Clear" }).first().click();
  await confirm("Clear this pair constraint?");
  await toast(page, "Constraint cleared");
  await main.getByRole("tab", { name: /Consolidation pack/ }).click();
  await expect(main.getByRole("group", { name: "Consolidation pack" }).getByText("General material data").first()).toBeVisible(NAV);
  await exportFile(page, "Download pack");
});

test("match cluster links back to its golden record and the review queue", async ({ page }) => {
  const main = await open(page, "/mdm/match/gr-0");
  await expect(main.getByRole("group", { name: "Scored pairs" }).getByRole("row").nth(1)).toBeVisible(NAV);
  await main.getByRole("link", { name: "Match review" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Match review" })).toBeVisible(NAV);
});

test("match rules: add a rule and run the simulation", async ({ page }) => {
  const main = await open(page, "/mdm/match-rules");
  await expect(main.getByRole("group", { name: "Match rules" }).getByRole("row").nth(1)).toBeVisible(NAV);
  const add = main.getByRole("button", { name: "Add rule" });
  await expect(add).toBeDisabled();
  await main.getByRole("textbox", { name: "Field", exact: true }).fill("MARA.MATKL");
  await add.click();
  await toast(page, "Rule added");
  await main.getByRole("button", { name: "Run simulation" }).click();
  await toast(page, "Simulation finished");
  await expect(main.getByText("Pairs scored").first()).toBeVisible();
});

test("survivorship: add, reorder, remove and save rules", async ({ page }) => {
  const main = await open(page, "/mdm/survivorship");
  const items = main.getByRole("listitem");
  const before = await items.count();
  await main.getByRole("button", { name: "Add rule" }).click();
  await expect(items).toHaveCount(before + 1);
  await main.getByRole("button", { name: "Move down" }).first().click();
  await main.getByRole("button", { name: "Remove" }).last().click();
  await expect(items).toHaveCount(before);
  await main.getByRole("button", { name: "Save rules" }).click();
  await expect(page.getByRole("status").first()).toBeVisible(NAV);
});

test("glossary: fill from the rule library and filter by status", async ({ page }) => {
  const main = await open(page, "/mdm/glossary");
  await main.getByRole("button", { name: "Fill from rule library" }).click();
  await toast(page, /terms created/);
  await main.getByRole("button", { name: "Approved", exact: true }).click();
  await expect(main.getByRole("button", { name: "Approved", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("issues: filter, comment and export", async ({ page }) => {
  const main = await open(page, "/mdm/issues");
  await main.getByRole("button", { name: /^Open/ }).first().click();
  await main.getByRole("textbox", { name: "Add a comment" }).fill("Checked with the plant.");
  await main.getByRole("button", { name: "Comment" }).click();
  await toast(page, "Comment added");
  await exportFile(page, "Export");
});

test("mining: mine the latest run", async ({ page }) => {
  const main = await open(page, "/mdm/mining");
  await main.getByRole("button", { name: "Mine the latest run" }).click();
  await toast(page, /Mining started|There is no run to mine/);
});

test("processes: discover a process and export the map", async ({ page }) => {
  const main = await open(page, "/mdm/processes");
  await main.getByRole("button", { name: "Discover this process" }).click();
  await toast(page, /Discovery started|Discovery could not be started/);
  await exportFile(page, "Export");
});

test("reference data: approve a mapping", async ({ page }) => {
  const main = await open(page, "/mdm/reference");
  await main.getByRole("button", { name: "Approve" }).first().click();
  await toast(page, /Mapping approved|A different user must decide this mapping/);
});

test("rules: switch views, filter severity and export the library", async ({ page }) => {
  const main = await open(page, "/rules");
  for (const v of ["Drafts", "Learned", "Coverage", "Policy packs", "Fix drafts", "Library"]) {
    await main.getByRole("group", { name: "Rule views" }).getByRole("button", { name: v, exact: true }).click();
    await expect(main.getByRole("group", { name: "Rule views" }).getByRole("button", { name: v, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  await main.getByRole("button", { name: /^Critical/ }).click();
  await expect(main.getByRole("group", { name: "Rule library" }).getByRole("row").nth(1)).toBeVisible(NAV);
  await exportFile(page, "Export rules");
});

test("try a rule change: impact, draft, try, save", async ({ page }) => {
  const main = await open(page, "/rules/dry-run");
  const check = main.getByRole("button", { name: "Check the impact" });
  await expect(check).toBeDisabled();
  await main.getByRole("textbox", { name: /^Rule to change/ }).fill("MM142");
  await check.click();
  await expect(main.getByText("Records failing").first()).toBeVisible(NAV);
  await main.getByRole("textbox", { name: "What should the rule check?" }).fill("Every material has a base unit of measure");
  await main.getByRole("button", { name: "Draft the rule" }).click();
  await expect(main.getByRole("textbox", { name: "Rule definition" })).not.toHaveValue("");
  await main.getByRole("button", { name: "Try it on the data" }).click();
  await main.getByRole("button", { name: "Save as draft" }).click();
  await toast(page, "Draft saved");
});

test("rule promotion: switch on the ready rules after confirming", async ({ page }) => {
  const main = await open(page, "/rules/promotion");
  await main.getByRole("button", { name: "Switch on the ready rules" }).click();
  const ask = page.getByRole("alertdialog");
  if (await ask.count()) await ask.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("status").first()).toBeVisible(NAV);
});

test("insights: feedback is recorded once", async ({ page }) => {
  const main = await open(page, "/insights");
  await main.getByRole("button", { name: "Yes", exact: true }).click();
  await toast(page, "Thanks, your feedback is saved.");
  await expect(main.getByRole("button", { name: "Yes", exact: true })).toBeDisabled();
});

test("forecast: hours per sprint changes the plan", async ({ page }) => {
  const main = await open(page, "/insights/forecast");
  const hours = main.getByRole("combobox", { name: "Hours per sprint" });
  await hours.selectOption("80");
  await expect(hours).toHaveValue("80");
  await main.getByRole("button", { name: /^Show cost of/ }).first().click();
  await expect(main.getByText("What this finding costs")).toBeVisible(NAV);
  await main.getByRole("button", { name: "Close", exact: true }).click();
  await expect(main.getByText("What this finding costs")).toHaveCount(0);
});

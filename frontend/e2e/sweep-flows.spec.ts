/**
 * Outcome flows the crawl cannot judge: what a click changes, what a download holds, what an empty or failed screen says.
 * Fixture mode (`?fixture=1`, no backend), so these prove the screens, not the API.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3113 npx playwright test e2e/sweep-flows.spec.ts
 */

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const NAV = { timeout: 90_000 };
test.setTimeout(150_000);

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
  await page.addInitScript(() => {
    try { localStorage.setItem("meridian:theme", "light"); } catch { /* blocked storage */ }
  });
  await page.route("**/api/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
});

const openIssues = async (page: import("@playwright/test").Page) => {
  await page.goto("/mdm/issues?fixture=1", NAV);
  await expect(page.getByRole("heading", { level: 1, name: "Record issues" })).toBeVisible(NAV);
  await expect(page.getByRole("row").nth(1)).toBeVisible(NAV);
};

test("issues: ticking rows then Start work changes their status and toasts", async ({ page }) => {
  await openIssues(page);
  await page.getByRole("row").nth(1).click();
  await expect(page.getByText("1 selected")).toBeVisible();
  await expect(page.getByRole("row").nth(1)).toContainText("+ ");
  await page.getByRole("button", { name: "Start work", exact: true }).click();
  await expect(page.getByRole("status").getByText("Issues updated")).toBeVisible();
  await expect(page.getByText("0 selected")).toBeVisible();
  await expect(page.getByRole("row").nth(1)).toContainText("In progress");
});

test("issues: Resolve marks the ticked row resolved", async ({ page }) => {
  await openIssues(page);
  await page.getByRole("row").nth(2).click();
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await expect(page.getByRole("status").getByText("Issues updated")).toBeVisible();
  await expect(page.getByRole("row").nth(2)).toContainText("Resolved");
});

test("issues: a comment lands in the history and the box clears", async ({ page }) => {
  await openIssues(page);
  await page.getByRole("row").nth(1).click();
  const box = page.getByRole("textbox", { name: "Add a comment" });
  await box.fill("Checked with plant 1000");
  await page.getByRole("button", { name: "Comment" }).click();
  await expect(page.getByRole("status").getByText("Comment added")).toBeVisible();
  await expect(box).toHaveValue("");
  await expect(page.getByText("Checked with plant 1000")).toBeVisible();
});

test("issues: a search that matches nothing shows the empty state", async ({ page }) => {
  await openIssues(page);
  await page.getByRole("searchbox", { name: "Search issues" }).fill("zzz-no-such-rule");
  await expect(page.getByText("No issues match")).toBeVisible();
});

test("issues: the CSV export saves a .csv file", async ({ page }) => {
  await openIssues(page);
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("radio", { name: /CSV/ }).check();
  const dl = page.waitForEvent("download");
  await page.locator(".mx-export").getByRole("button", { name: "Export" }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toMatch(/\.csv$/);
});

test("audit: the export is a CSV that parses with the documented header", async ({ page }) => {
  await page.goto("/admin/audit?fixture=1", NAV);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible(NAV);
  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("radio", { name: "CSV" }).check();
  const dl = page.waitForEvent("download");
  await page.locator(".mx-export").getByRole("button", { name: "Export" }).click();
  const file = await dl;
  const lines = readFileSync((await file.path()) as string, "utf8").trim().split("\n");
  expect(lines[0]).toBe("time,actor,action,object,method,path,status");
  expect(lines.length).toBeGreaterThan(1);
  for (const l of lines.slice(1)) expect(l.split(",").length).toBe(7);
});

test("error state: a failed read says so, and Try again asks again", async ({ page }) => {
  let hits = 0;
  await page.route("**/api/v1/**", (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/auth/me")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user: { id: "u1", email: "a@x.test", name: "Test Admin", role: "admin", permissions: ["*"] }, must_change_password: false }) });
    }
    hits++;
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "boom" }) });
  });
  await page.goto("/objects", NAV);
  const retry = page.getByRole("button", { name: "Try again" }).first();
  await expect(retry).toBeVisible(NAV);
  const before = hits;
  await retry.click();
  await expect.poll(() => hits, { timeout: 15_000 }).toBeGreaterThan(before);
});

/**
 * Meridian 2, step 6d: help content and videos, in fixture mode (`/?fixture=1&open=help`), so the spec needs no API.
 * At 1440 and 390, light and dark: the role's walkthrough and the screen's chapter come first, the current interface's
 * chapters are marked, search finds words said only in a recording, a chapter plays its recording in the panel with the
 * poster and a captions track, and the walkthrough's next-step button opens the next screen with help still open. Axe
 * finds no critical or serious violation, and a screenshot of each lands in e2e/__screenshots__/v2/help-*.png.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test e2e/v2-help.spec.ts
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SHOTS = path.join(__dirname, "__screenshots__", "v2");
const VIDEOS = path.join(__dirname, "..", "docs", "help-videos");
const SIZES = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const;
const SCHEMES = ["light", "dark"] as const;
const NAV = { timeout: 90_000 };
const TYPES: Record<string, string> = { mp4: "video/mp4", jpg: "image/jpeg", vtt: "text/vtt" };

async function prepare(page: Page, scheme: "light" | "dark") {
  await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
  await page.addInitScript((s) => {
    try {
      localStorage.setItem("meridian:theme", s);
    } catch {
      /* blocked storage: the page falls back to the system scheme */
    }
  }, scheme);
  await page.route("**/api/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  // The recordings, posters and captions as the API serves them, from the files the recorder made.
  await page.route("**/api/v1/docs/help-videos/*", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    const file = path.join(VIDEOS, name);
    if (!/^[a-z0-9-]+\.(mp4|jpg|vtt)$/.test(name) || !existsSync(file)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: TYPES[name.split(".").pop() as string], body: readFileSync(file) });
  });
}

async function axe(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blockers = result.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  const summary = blockers.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`).join("\n");
  console.log(`[a11y] ${label}: ${result.violations.filter((v) => v.impact === "moderate").length} moderate, ${result.violations.filter((v) => v.impact === "minor").length} minor (non-blocking)`);
  expect(blockers, summary).toEqual([]);
}

const titles = (page: Page, list: string) => page.getByRole("dialog", { name: "Help" }).getByRole("list", { name: list }).locator(".m2-ht").allTextContents();

for (const size of SIZES) {
  for (const scheme of SCHEMES) {
    test.describe(`v2 help at ${size.name}, ${scheme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });
      test.setTimeout(150_000);
      const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}_${size.name}_${scheme}.png`) });

      test("the index: the walkthrough and the screen's chapter first, nothing of the retired interface, captions searched", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/?fixture=1&persona=steward&open=help", { waitUntil: "load", timeout: 90_000 });
        const help = page.getByRole("dialog", { name: "Help" });
        await expect(help.getByRole("heading", { name: "On this screen" })).toBeVisible(NAV);
        expect((await titles(page, "Help for this screen")).slice(0, 2)).toEqual(["Walkthrough: data steward", "Landscape"]);
        await expect(help.getByRole("heading", { name: "Current interface", exact: true })).toHaveCount(0);
        await expect(help.getByTestId("whats-new").getByRole("listitem")).toHaveCount(13);
        await page.waitForLoadState("networkidle");
        await shot(page, "help-index");
        await axe(page, `help index ${size.name} ${scheme}`);
        await help.getByRole("searchbox", { name: "Search help" }).fill("slash");
        await expect(help.getByRole("button", { name: /Meridian in three minutes/ })).toContainText("From the recording:");
        await shot(page, "help-search");
      });

      test("a chapter plays its recording in the panel, with the poster and the captions", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/work?fixture=1&persona=steward&open=help", { waitUntil: "load", timeout: 90_000 });
        const help = page.getByRole("dialog", { name: "Help" });
        await expect(help.getByRole("heading", { name: "On this screen" })).toBeVisible(NAV);
        expect((await titles(page, "Help for this screen"))[0]).toBe("The Work ledger");
        await help.getByRole("button", { name: /^The Work ledger/ }).click();
        const chapter = help.getByTestId("help-chapter");
        const video = chapter.locator("video");
        await expect(video).toHaveAttribute("poster", "/api/v1/docs/help-videos/guide2-work.jpg");
        await expect(video.locator("source")).toHaveAttribute("src", "/api/v1/docs/help-videos/guide2-work.mp4");
        await expect(video.locator("track")).toHaveAttribute("kind", "captions");
        await expect(video.locator("track")).toHaveAttribute("src", "/api/v1/docs/help-videos/guide2-work.vtt");
        await expect(chapter.getByRole("heading", { name: "When something is wrong" })).toBeAttached();
        // The poster draws once its file arrives; wait for the image before the screenshot.
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await shot(page, "help-chapter");
        await axe(page, `help chapter ${size.name} ${scheme}`);
      });

      test("a role's walkthrough: five steps with the screen names, and the next step opens the next screen", async ({ page }) => {
        await prepare(page, scheme);
        await page.goto("/?fixture=1&role=data_owner&open=help&chapter=v2%3Apersona-owner", { waitUntil: "load", timeout: 90_000 });
        const help = page.getByRole("dialog", { name: "Help" });
        const walk = help.getByTestId("walkthrough");
        await expect(walk.getByRole("listitem")).toHaveCount(5, NAV);
        await expect(walk.getByTestId("walkthrough-at")).toHaveText("Step 1 of 5: Landscape");
        await page.waitForLoadState("networkidle");
        await shot(page, "help-walkthrough");
        await axe(page, `help walkthrough ${size.name} ${scheme}`);
        await walk.getByRole("link", { name: "Next step: Batch B-241" }).click();
        await expect(page).toHaveURL(/open=batch/, NAV);
        await expect(page.getByRole("dialog", { name: /Batch B-241/ })).toBeVisible(NAV);
      });
    });
  }
}
